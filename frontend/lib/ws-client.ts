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
  // After exponential backoff is exhausted we fall back to a slow periodic
  // retry so a mobile client that lost connectivity (e.g. backgrounded on
  // Android) eventually reconnects instead of staying silently dead.
  private slowTimer: ReturnType<typeof setInterval> | null = null
  private listenersBound = false

  connect(userId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) return
    this.userId = userId
    this.bindListeners()
    requestNotificationPermission()

    try {
      this.ws = new WebSocket(WS_URL)
      this.ws.onopen = () => {
        this.isConnected = true
        this.reconnectAttempts = 0
        this.stopSlowRetry()
        useStore.getState().setWsConnected(true)
        this.auth()
        this.flush()
      }
      this.ws.onmessage = async (event) => {
        const lines = event.data.split('\n').filter(Boolean)
        for (const line of lines) {
          try { await this.handle(JSON.parse(line)) } catch (e) { console.warn('[ws] dropped unparseable frame', e) }
        }
      }
      this.ws.onclose = () => {
        this.isConnected = false
        useStore.getState().setWsConnected(false)
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
    this.stopSlowRetry()
    this.ws?.close()
    this.ws = null
    this.isConnected = false
    useStore.getState().setWsConnected(false)
  }

  send(type: string, payload: any) {
    const msg = JSON.stringify({ type, payload })
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg)
    } else {
      this.queue.push(msg)
    }
  }

  // Number of outbound frames waiting for the socket to come back. Surfaced
  // in the connection banner so users see what will auto-flush on reconnect.
  getQueuedCount(): number {
    return this.queue.length
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
    if (this.reconnectAttempts >= this.maxReconnect) {
      // Exponential backoff exhausted: switch to a slow persistent retry so a
      // returning connection (foregrounding the app on Android, regaining
      // signal) eventually re-establishes the socket instead of staying dead.
      this.startSlowRetry()
      return
    }
    this.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    setTimeout(() => this.connect(this.userId), delay)
  }

  private startSlowRetry() {
    if (this.slowTimer) return
    this.slowTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.stopSlowRetry()
        return
      }
      this.reconnectAttempts = 0
      this.connect(this.userId)
    }, 30000)
  }

  private stopSlowRetry() {
    if (this.slowTimer) {
      clearInterval(this.slowTimer)
      this.slowTimer = null
    }
  }

  // Bind browser lifecycle events once so we reconnect immediately when the
  // device comes back online or the tab is foregrounded — critical on mobile,
  // where the OS suspends sockets while the app is backgrounded.
  private bindListeners() {
    if (this.listenersBound || typeof window === 'undefined') return
    this.listenersBound = true
    window.addEventListener('online', () => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        this.reconnectAttempts = 0
        this.connect(this.userId)
      }
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.ws?.readyState !== WebSocket.OPEN) {
        this.reconnectAttempts = 0
        this.connect(this.userId)
      }
    })
  }

  private async handle(msg: { type: string; payload: any }) {
    const store = useStore.getState()

    switch (msg.type) {
      case 'message': {
        const p = msg.payload
        const myId = store.user?.id
        const isOwn = p.senderId === myId
        let plainContent = ''
        // Group: each member has its own ciphertext under p.recipients[myId].
        const mine = p.recipients && myId ? p.recipients[myId] : undefined
        const encContent = mine?.content ?? p.content
        const encKey = mine?.encryptedKey ?? p.encryptedKey
        const encIV = mine?.iv ?? p.iv
        // Only decrypt messages actually addressed to us. Our own outgoing message
        // is echoed back encrypted to the *recipient*, which we cannot decrypt —
        // and the local optimistic copy (added on send) already holds the
        // plaintext. Re-adding that echo would clobber our plaintext with
        // ciphertext and render "[ENCRYPTED] <blob>" for our own sent messages.
        if (!isOwn && p.encrypted && store.keyPair?.privateKey && encContent && encKey && encIV) {
          try {
            plainContent = await decryptMessage(encIV, encKey, encContent, store.keyPair.privateKey)
          } catch {}
        }
        // Own message: keep the local plaintext copy we added on send; do not let
        // the recipient-encrypted echo overwrite it. Delivery status arrives via
        // message_ack.
        if (isOwn) break
        await this.ensureConversation(p.conversationId)
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
        const sender = store.contacts.find(c => c.userId === p.senderId)
        notify(
          sender?.displayName || 'CRYPTMessenger',
          'Encrypted message 🔒',
          () => store.setActiveConversation(p.conversationId)
        )
        break
      }

      case 'message_sync': {
        // Offline / multi-device replay pushed by the server on (re)connect.
        // Merged silently: no OS notification (would spam for every historical
        // message), but addMessage still bumps the unread badge for messages
        // we didn't already have locally.
        const p = msg.payload
        const myId = store.user?.id
        let plainContent = ''
        const mine = p.recipients && myId ? p.recipients[myId] : undefined
        const encContent = mine?.content ?? p.content
        const encKey = mine?.encryptedKey ?? p.encryptedKey
        const encIV = mine?.iv ?? p.iv
        if (p.encrypted && store.keyPair?.privateKey && encContent && encKey && encIV) {
          try {
            plainContent = await decryptMessage(encIV, encKey, encContent, store.keyPair.privateKey)
          } catch {}
        }
        await this.ensureConversation(p.conversationId)
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

      case 'contact_decline': {
        const p = msg.payload
        // We were the original sender: our outgoing request was declined, so
        // clear the pending state (it would otherwise stay "pending" forever).
        store.removePendingRequest(p.fromUserId)
        if (p.fromUserId !== store.user?.id) {
          notify('Request declined', `${p.displayName || 'A contact'} declined your request`)
        }
        break
      }

      case 'typing': {
        const p = msg.payload
        // Honor the recipient's privacy setting: don't surface "typing…" if
        // they've disabled typing indicators.
        if (p.conversationId && store.settings.typingEnabled) {
          store.setTyping(p.conversationId, !!p.typing)
        }
        break
      }

      case 'message_delete': {
        const p = msg.payload
        if (p.conversationId && p.id) {
          store.removeMessage(p.conversationId, p.id)
        }
        break
      }

      case 'message_expire': {
        // Burn-after-read: the server deleted an ephemeral ("disappearing")
        // message (either because the recipient read it, or its TTL elapsed).
        // Remove it from the conversation UI for both members so it visibly
        // disappears here too — not only on the sender's screen.
        const p = msg.payload
        if (p.conversationId && p.id) {
          store.removeMessage(p.conversationId, p.id)
        }
        break
      }

      case 'presence': {
        // Real-time presence: a peer connected or disconnected. Update the
        // matching contact's status so the UI shows an accurate online dot.
        const p = msg.payload
        if (p.presenceUserId) {
          store.setContactPresence(
            p.presenceUserId,
            p.presenceStatus === 'online' ? 'online' : 'offline'
          )
        }
        break
      }
    }
  }

  async sendEncryptedMessage(conversationId: string, plaintext: string, opts?: { ephemeral?: boolean }) {
    const store = useStore.getState()
    const conv = store.conversations.find((c) => c.id === conversationId)
    const user = store.user
    if (!conv || !user) return

    const msgId = uid()
    // A per-message 🔥 toggle (opts.ephemeral) forces a disappearing message
    // for just this one send; otherwise we fall back to the global
    // disappearing-TTL setting. ttl=0 means "burn after the recipient reads
    // it" (the server enforces this on the read receipt).
    const globalEphemeral = store.settings.disappearingTTL > 0
    const ephemeral = opts?.ephemeral ?? globalEphemeral
    const ttl = opts?.ephemeral ? 0 : store.settings.disappearingTTL
    const members = (conv.participants || []).filter((p) => p && p !== user.id)

    // Group (multi-member): encrypt a separate ciphertext per recipient so
    // each member can decrypt only their own. The hub relays the whole
    // payload to every member.
    if (members.length > 1) {
      const recipients: Record<string, { content: string; encryptedKey: string; iv: string }> = {}
      let allEncrypted = true
      const missing: string[] = []
      for (const mid of members) {
        const contact = store.contacts.find((c) => c.userId === mid)
        if (!contact?.publicKey) { allEncrypted = false; missing.push(contact?.displayName || mid); continue }
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
      if (missing.length) {
        // Members without a public key can't decrypt the per-recipient
        // ciphertext, so they receive nothing — warn the sender instead of
        // letting the message silently vanish for them.
        showToast(
          'Message partiel',
          `${missing.join(', ')} n'a pas encore de clé et ne recevra pas ce message`,
        )
      }
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

  declineContact(request: ContactRequest) {
    const store = useStore.getState()
    const myId = store.user?.id || ''
    this.send('contact_decline', {
      fromUserId: myId,
      toUserId: request.fromUserId,
      contactId: request.id,
      displayName: store.user?.displayName || '',
    })
    // Optimistically clear the local incoming request; the server also drops
    // it so it will not be redelivered on the next connect.
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

  /** Unsend a message: tell every peer in the conversation to drop it. */
  // Ensure a conversation exists in the local store. Group (and any
  // server-created) conversations are only registered for the creator; other
  // members receive messages for a conversation they don't yet have locally.
  // Pull the user's conversations from the server and merge in any missing one
  // so the incoming message can be displayed (and the chat-list preview shows).
  private async ensureConversation(convId: string) {
    const store = useStore.getState()
    if (store.conversations.some((c) => c.id === convId)) return
    try {
      const list = await api.listConversations()
      if (!Array.isArray(list)) return
      const existing = new Set(store.conversations.map((c) => c.id))
      for (const c of list) {
        if (!c || !c.id || existing.has(c.id)) continue
        const members: string[] = Array.isArray(c.members)
          ? (c.members as any[]).map(String)
          : Array.isArray(c.participants)
            ? (c.participants as any[]).map(String)
            : []
        store.addConversation({
          id: c.id,
          participants: members,
          name: c.name || '',
          unreadCount: 0,
          encryptionEnabled: true,
          networkPreference: 'hybrid',
          updatedAt: c.updatedAt || Date.now(),
        })
      }
    } catch {}
  }

  sendMessageDelete(conversationId: string, messageId: string, recipientId: string) {
    this.send('message_delete', { conversationId, id: messageId, recipientId })
  }
}

export const wsManager = new WSManager()
