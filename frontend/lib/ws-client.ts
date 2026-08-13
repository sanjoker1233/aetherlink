import { useStore } from './store'
import { decryptMessage, encryptMessage } from './e2e'
import { api } from './api'
import { notify, requestNotificationPermission } from './notifications'
import { showToast } from './toast'
import type { Message, ContactRequest, Contact } from './types'

function checkServer() {
  api.health()
    .then(() => useStore.getState().setServerAvailable(true))
    .catch(() => useStore.getState().setServerAvailable(false))
}

const WS_URL = api.getWSURL()

let _idCounter = 0
function uid() {
  const arr = new Uint8Array(8)
  crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('') + (++_idCounter)
}

function convId(a: string, b: string): string {
  return [a, b].sort().join('__')
}

export class WSManager {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnect = 50
  private queue: string[] = []
  private isConnected = false
  private userId = ''

  connect(userId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) return
    this.userId = userId
    requestNotificationPermission()

    try {
      this.ws = new WebSocket(WS_URL)
      this.ws.onopen = () => {
        this.isConnected = true
        this.reconnectAttempts = 0
        this.auth()
        this.flush()
      }
      this.ws.onmessage = async (event) => {
        const lines = event.data.split('\n').filter(Boolean)
        for (const line of lines) {
          try { await this.handle(JSON.parse(line)) } catch {}
        }
      }
      this.ws.onclose = () => {
        this.isConnected = false
        checkServer()
        this.reconnect()
      }
      this.ws.onerror = () => {}
    } catch {
      this.reconnect()
    }
  }

  disconnect() {
    this.reconnectAttempts = this.maxReconnect
    this.ws?.close()
    this.ws = null
    this.isConnected = false
  }

  send(type: string, payload: any) {
    const msg = JSON.stringify({ type, payload })
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg)
    } else {
      this.queue.push(msg)
    }
  }

  private auth() {
    // In-memory token only (never localStorage).
    const token = api.getToken()
    this.send('auth', { senderId: this.userId, token: token || '' })
  }

  private flush() {
    while (this.queue.length > 0) {
      const msg = this.queue.shift()
      if (msg && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(msg)
      }
    }
  }

  private reconnect() {
    if (this.reconnectAttempts >= this.maxReconnect) return
    this.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    setTimeout(() => this.connect(this.userId), delay)
  }

  private async handle(msg: { type: string; payload: any }) {
    const store = useStore.getState()

    switch (msg.type) {
      case 'message': {
        const p = msg.payload
        const myId = store.user?.id
        let plainContent = ''
        // Group: each member has its own ciphertext under p.recipients[myId].
        const mine = p.recipients && myId ? p.recipients[myId] : undefined
        const encContent = mine?.content ?? p.content
        const encKey = mine?.encryptedKey ?? p.encryptedKey
        const encIV = mine?.iv ?? p.iv
        if (p.encrypted && store.keyPair?.privateKey && encContent && encKey && encIV) {
          try {
            plainContent = await decryptMessage(encIV, encKey, encContent, store.keyPair.privateKey)
          } catch {}
        }
        store.addMessage(p.conversationId, {
          id: p.id, conversationId: p.conversationId,
          senderId: p.senderId, content: p.content,
          plainContent: plainContent || undefined,
          encrypted: p.encrypted, encryptedKey: p.encryptedKey,
          iv: p.iv, timestamp: p.timestamp || Date.now(),
          status: 'sent',
          ephemeral: p.ephemeral || undefined,
          ttl: p.ttl || undefined,
        })
        if (p.senderId !== store.user?.id) {
          const sender = store.contacts.find(c => c.userId === p.senderId)
          notify(
            sender?.displayName || 'CRYPTMessenger',
            'Encrypted message 🔒',
            () => store.setActiveConversation(p.conversationId)
          )
        }
        break
      }

      case 'message_read': {
        const p = msg.payload
        if (p.conversationId && Array.isArray(p.messageIds)) {
          store.markMessagesRead(p.conversationId, p.messageIds)
        }
        break
      }
      case 'message_ack':
        store.updateMessageStatus(msg.payload.id, 'delivered')
        break

      case 'contact_request': {
        const p = msg.payload
        const cr: ContactRequest = {
          id: uid(), fromUserId: p.fromUserId,
          fromName: p.displayName || 'Unknown',
          fromFingerprint: p.fingerprint || '',
          fromPublicKey: p.publicKey || '',
          status: 'pending', timestamp: Date.now(),
        }
        store.addContactRequest(cr)
        if (p.fromUserId !== store.user?.id) {
          notify('New contact request', p.displayName || 'Unknown')
          // Always-visible in-app toast (notify() only fires an OS notification
          // when the tab is backgrounded + permission granted, so a foreground
          // manual tester would otherwise see nothing).
          showToast(
            'New contact request',
            `${p.displayName || 'Unknown'} wants to add you`,
            () => useStore.getState().setActiveTab('contacts')
          )
        }
        break
      }

      case 'contact_accept': {
        const p = msg.payload
        const myId = store.user?.id || ''
        const contact: Contact = {
          id: uid(), userId: p.fromUserId,
          displayName: p.displayName || 'Contact',
          publicKey: p.publicKey || '',
          publicKeyFingerprint: p.fingerprint || '',
          status: 'online', createdAt: Date.now(),
        }
        store.addContact(contact)
        // We were the requester (original sender); clear the pending state.
        store.removePendingRequest(p.fromUserId)
        const cid = p.conversationId || convId(myId, p.fromUserId)
        const conv = {
          id: cid, participants: [myId, p.fromUserId],
          name: contact.displayName, unreadCount: 0,
          encryptionEnabled: true, networkPreference: 'hybrid' as const,
          updatedAt: Date.now(),
        }
        store.addConversation(conv)
        if (p.fromUserId !== store.user?.id) {
          notify('Request accepted', `${p.displayName || 'A contact'} accepted your request`)
        }
        break
      }

      case 'typing': {
        const p = msg.payload
        if (p.conversationId) {
          store.setTyping(p.conversationId, !!p.typing)
        }
        break
      }
    }
  }

  async sendEncryptedMessage(conversationId: string, plaintext: string) {
    const store = useStore.getState()
    const conv = store.conversations.find((c) => c.id === conversationId)
    const user = store.user
    if (!conv || !user) return

    const msgId = uid()
    const ephemeral = store.settings.disappearingTTL > 0
    const ttl = store.settings.disappearingTTL
    const members = (conv.participants || []).filter((p) => p && p !== user.id)

    // Group (multi-member): encrypt a separate ciphertext per recipient so
    // each member can decrypt only their own. The hub relays the whole
    // payload to every member.
    if (members.length > 1) {
      const recipients: Record<string, { content: string; encryptedKey: string; iv: string }> = {}
      let allEncrypted = true
      for (const mid of members) {
        const contact = store.contacts.find((c) => c.userId === mid)
        if (!contact?.publicKey) { allEncrypted = false; continue }
        try {
          const r = await encryptMessage(plaintext, contact.publicKey)
          recipients[mid] = { content: r.ciphertext, encryptedKey: r.encryptedKey, iv: r.iv }
        } catch {
          allEncrypted = false
        }
      }
      const msg: Message = {
        id: msgId, conversationId, senderId: user.id,
        content: '', plainContent: plaintext, encrypted: allEncrypted,
        timestamp: Date.now(), status: 'sending',
        ephemeral: ephemeral || undefined, ttl: ephemeral ? ttl : undefined,
      }
      store.addMessage(conversationId, msg)
      const { plainContent: _omit, ...wireMsg } = msg
      this.send('message', { ...wireMsg, recipientId: members[0], recipients })
      store.updateMessageStatus(msgId, 'sent')
      return
    }

    // 1:1 DM (single recipient) — original single-ciphertext path.
    const recipient = store.contacts.find((c) => conv.participants.includes(c.userId))
    if (!recipient || !recipient.publicKey) return
    let content = plaintext
    let encrypted = false
    let encryptedKey = ''
    let iv = ''
    if (store.settings.encryptionEnabled) {
      try {
        const result = await encryptMessage(plaintext, recipient.publicKey)
        content = result.ciphertext
        encryptedKey = result.encryptedKey
        iv = result.iv
        encrypted = true
      } catch {}
    }
    const msg: Message = {
      id: msgId, conversationId, senderId: user.id,
      content, plainContent: plaintext, encrypted, encryptedKey, iv,
      timestamp: Date.now(), status: 'sending',
      ephemeral: ephemeral || undefined, ttl: ephemeral ? ttl : undefined,
    }
    store.addMessage(conversationId, msg)
    const { plainContent: _omit2, ...wireMsg } = msg
    this.send('message', { ...wireMsg, recipientId: recipient.userId })
    store.updateMessageStatus(msgId, 'sent')
  }

  /** Tell the original sender that the given messages were seen ("Vu"). */
  sendReadReceipt(conversationId: string, messageIds: string[], senderId: string) {
    if (!messageIds.length) return
    this.send('message_read', {
      conversationId,
      messageIds,
      recipientId: senderId,
    })
  }

  sendContactRequest(toUserId: string) {
    const store = useStore.getState()
    const user = store.user
    if (!user) return
    this.send('contact_request', {
      fromUserId: user.id,
      toUserId,
      displayName: user.displayName,
      publicKey: user.publicKey,
      fingerprint: user.publicKeyFingerprint,
      contactId: uid(),
    })
    store.addPendingRequest(toUserId)
  }

  acceptContact(request: ContactRequest) {
    const store = useStore.getState()
    const myId = store.user?.id || ''
    const cid = convId(myId, request.fromUserId)
    this.send('contact_accept', {
      fromUserId: myId,
      toUserId: request.fromUserId,
      displayName: store.user?.displayName || '',
      publicKey: store.user?.publicKey || '',
      fingerprint: store.user?.publicKeyFingerprint || '',
      conversationId: cid,
    })
    const contact: Contact = {
      id: uid(), userId: request.fromUserId,
      displayName: request.fromName,
      publicKey: request.fromPublicKey,
      publicKeyFingerprint: request.fromFingerprint,
      status: 'online', createdAt: Date.now(),
    }
    store.addContact(contact)
    const conv = {
      id: cid, participants: [myId, request.fromUserId],
      name: request.fromName, unreadCount: 0,
      encryptionEnabled: true, networkPreference: 'hybrid' as const,
      updatedAt: Date.now(),
    }
    store.addConversation(conv)
    store.removeContactRequest(request.id)
  }

  requestUserInfo(userId: string) {
    this.send('user_info_request', {
      senderId: this.userId,
      toUserId: userId,
    })
  }

  sendTyping(conversationId: string, recipientId: string, typing: boolean) {
    this.send('typing', { conversationId, recipientId, typing })
  }
}

export const wsManager = new WSManager()
