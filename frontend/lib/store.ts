'use client'

import { create } from 'zustand'
import type {
  User, Contact, Message, Conversation, NetworkType,
  MeshNetwork, NetworkNode, AuthKeyPair, AppSettings, TabType, ContactRequest,
} from './types'
import { api } from './api'
import { loadPrivateKey, clearPrivateKey, decryptMessage } from './e2e'

interface AppState {
  user: User | null
  keyPair: AuthKeyPair | null
  isAuthenticated: boolean

  contacts: Contact[]
  contactRequests: ContactRequest[]
  pendingRequests: string[]
  conversations: Conversation[]
  activeConversationId: string | null
  selectedMessage: { convId: string; msg: Message } | null
  messages: Record<string, Message[]>

  meshNetwork: MeshNetwork
  activeNetwork: NetworkType
  networkStrength: number

  activeTab: TabType
  isSidebarOpen: boolean
  serverAvailable: boolean | null
  typing: Record<string, boolean>
  settings: AppSettings
  hydrated: boolean

  setServerAvailable: (v: boolean | null) => void
  setTyping: (conversationId: string, typing: boolean) => void
  setUser: (u: User | null) => void
  setKeyPair: (kp: AuthKeyPair | null) => void
  setAuthenticated: (v: boolean) => void

  setContacts: (c: Contact[]) => void
  addContact: (c: Contact) => void
  removeContact: (id: string) => void
  setContactVerified: (userId: string, verified: boolean) => void

  setContactRequests: (r: ContactRequest[]) => void
  addContactRequest: (r: ContactRequest) => void
  removeContactRequest: (id: string) => void
  addPendingRequest: (userId: string) => void
  removePendingRequest: (userId: string) => void

  setConversations: (c: Conversation[]) => void
  addConversation: (c: Conversation) => void
  setActiveConversation: (id: string | null) => void
  setSelectedMessage: (sel: { convId: string; msg: Message } | null) => void
  markConversationRead: (id: string) => void

  addMessage: (convId: string, msg: Message) => void
  updateMessageStatus: (msgId: string, status: Message['status']) => void
  markMessagesRead: (convId: string, ids: string[]) => void
  removeMessage: (convId: string, msgId: string) => void

  setMeshNetwork: (n: MeshNetwork) => void
  updateNetworkNode: (n: NetworkNode) => void
  setActiveNetwork: (t: NetworkType) => void
  setNetworkStrength: (s: number) => void

  setActiveTab: (t: TabType) => void
  setSidebarOpen: (v: boolean) => void
  updateSettings: (s: Partial<AppSettings>) => void
  hydrate: () => Promise<void>
  logout: () => void
}

// scheduleDisappear deletes a message once its TTL elapses. An ephemeral
// message (Snapchat-style) carries its OWN ttl set by the sender, which the
// recipient honors regardless of their own disappearing-message setting.
// Purely client-side; no server round-trip.
const scheduleDisappear = (convId: string, msg: Message) => {
  const settings = useStore.getState().settings
  const ttl = msg.ephemeral && msg.ttl && msg.ttl > 0
    ? msg.ttl
    : settings.disappearingTTL
  if (ttl <= 0) return
  const remaining = ttl - (Date.now() - msg.timestamp)
  if (remaining <= 0) {
    useStore.getState().removeMessage(convId, msg.id)
  } else {
    setTimeout(() => useStore.getState().removeMessage(convId, msg.id), remaining)
  }
}

const defaultSettings: AppSettings = {
  theme: 'dark', preferredNetwork: 'hybrid', autoSwitchNetwork: true,
  encryptionEnabled: true, notificationsEnabled: true, offlineMode: false,
  decryptDuration: 0, disappearingTTL: 0,
}

// SECURITY: never persist decrypted message bodies. `plainContent` is dropped
// on the way to localStorage and re-derived in memory at hydration time.
const stripPlain = (_key: string, value: any) => (_key === 'plainContent' ? undefined : value)

const saveToStorage = (data: Partial<AppState>) => {
  if (typeof window === 'undefined') return
  try {
    const prevRaw = localStorage.getItem('crypt_state')
    const prev = prevRaw ? JSON.parse(prevRaw) : {}
    const toSave: any = { ...prev }
    if (data.contacts) toSave.contacts = data.contacts
    if (data.conversations) toSave.conversations = data.conversations
    if (data.messages) toSave.messages = data.messages
    if (data.contactRequests) toSave.contactRequests = data.contactRequests
    localStorage.setItem('crypt_state', JSON.stringify(toSave, stripPlain))
  } catch {}
}

export const useStore = create<AppState>((set, get) => ({
  // Start from empty defaults so server and first client render match.
  user: null,
  keyPair: null,
  isAuthenticated: false,
  hydrated: false,

  contacts: [],
  contactRequests: [],
  pendingRequests: [],
  conversations: [],
  activeConversationId: null,
  selectedMessage: null,
  messages: {},

  meshNetwork: { nodes: [], links: [], activeType: 'internet', isSimulated: false },
  activeNetwork: 'internet',
  networkStrength: 100,
  serverAvailable: null,
  typing: {},
  activeTab: 'chats',
  isSidebarOpen: true,
  settings: { ...defaultSettings },

  setUser: (user) => set({ user }),
  setKeyPair: (kp) => set({ keyPair: kp }),
  setAuthenticated: (v) => set({ isAuthenticated: v }),

  setContacts: (contacts) => { set({ contacts }); saveToStorage({ contacts }) },
  addContact: (contact) => {
    const contacts = [...get().contacts, contact]
    set({ contacts }); saveToStorage({ contacts })
  },
  removeContact: (userId) => {
    const contacts = get().contacts.filter((c) => c.userId !== userId && c.id !== userId)
    const convsToRemove = new Set(
      get().conversations
        .filter((c) => c.participants.includes(userId))
        .map((c) => c.id)
    )
    const conversations = get().conversations.filter((c) => !convsToRemove.has(c.id))
    const messages = { ...get().messages }
    convsToRemove.forEach((cid) => { delete messages[cid] })
    set({ contacts, conversations, messages })
    saveToStorage({ contacts, conversations, messages })
  },
  setContactVerified: (userId, verified) => {
    const contacts = get().contacts.map((c) =>
      c.userId === userId ? { ...c, verified } : c
    )
    set({ contacts }); saveToStorage({ contacts })
  },

  setContactRequests: (r) => set({ contactRequests: r }),
  addContactRequest: (r) => {
    const contactRequests = [...get().contactRequests, r]
    set({ contactRequests }); saveToStorage({ contactRequests })
  },
  removeContactRequest: (id) => {
    const contactRequests = get().contactRequests.filter((c) => c.id !== id)
    set({ contactRequests }); saveToStorage({ contactRequests })
  },
  addPendingRequest: (userId) => {
    if (get().pendingRequests.includes(userId)) return
    set({ pendingRequests: [...get().pendingRequests, userId] })
  },
  removePendingRequest: (userId) => {
    set({ pendingRequests: get().pendingRequests.filter((u) => u !== userId) })
  },

  setConversations: (c) => { set({ conversations: c }); saveToStorage({ conversations: c }) },
  addConversation: (conv) => {
    const conversations = [...get().conversations, conv]
    set({ conversations }); saveToStorage({ conversations })
  },
  setActiveConversation: (id) => set({ activeConversationId: id }),
  setSelectedMessage: (sel) => set({ selectedMessage: sel }),
  markConversationRead: (id) => {
    const conversations = get().conversations.map((c) =>
      c.id === id ? { ...c, unreadCount: 0 } : c
    )
    set({ conversations }); saveToStorage({ conversations })
  },

  addMessage: (convId, msg) => {
    const existing = get().messages[convId] || []
    if (existing.some((m) => m.id === msg.id)) return
    const messages = { ...get().messages, [convId]: [...existing, msg] }
    const conversations = get().conversations.map((c) =>
      c.id === convId ? { ...c, lastMessage: msg, updatedAt: msg.timestamp,
        unreadCount: msg.senderId !== get().user?.id ? c.unreadCount + 1 : c.unreadCount
      } : c
    )
    set({ messages, conversations })
    saveToStorage({ messages, conversations })
    scheduleDisappear(convId, msg)
  },
  updateMessageStatus: (msgId, status) => {
    const messages = { ...get().messages }
    for (const key of Object.keys(messages)) {
      messages[key] = messages[key].map((m) => m.id === msgId ? { ...m, status } : m)
    }
    set({ messages }); saveToStorage({ messages })
  },
  markMessagesRead: (convId, ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const messages = { ...get().messages }
    if (!messages[convId]) return
    let changed = false
    messages[convId] = messages[convId].map((m) => {
      if (idSet.has(m.id) && !m.read) {
        changed = true
        return { ...m, read: true, readAt: Date.now() }
      }
      return m
    })
    if (changed) {
      set({ messages }); saveToStorage({ messages })
    }
  },
  removeMessage: (convId, msgId) => {
    const messages = { ...get().messages }
    if (messages[convId]) {
      messages[convId] = messages[convId].filter((m) => m.id !== msgId)
    }
    set({ messages }); saveToStorage({ messages })
  },

  setMeshNetwork: (n) => set({ meshNetwork: n }),
  updateNetworkNode: (node) => set((s) => ({
    meshNetwork: {
      ...s.meshNetwork,
      nodes: s.meshNetwork.nodes.map((n) => n.id === node.id ? node : n),
    },
  })),
  setActiveNetwork: (t) => set({ activeNetwork: t }),
  setNetworkStrength: (s) => set({ networkStrength: s }),
  setActiveTab: (t) => set({ activeTab: t }),
  setSidebarOpen: (v) => set({ isSidebarOpen: v }),
  setServerAvailable: (v) => set({ serverAvailable: v }),
  setTyping: (conversationId, typing) => {
    set((s) => ({ typing: { ...s.typing, [conversationId]: typing } }))
    if (typing) {
      // Auto-clear after a short grace period in case the peer stops sending.
      setTimeout(() => {
        const cur = useStore.getState().typing[conversationId]
        if (cur) set((s) => ({ typing: { ...s.typing, [conversationId]: false } }))
      }, 3000)
    }
  },
  updateSettings: (s) => {
    const settings = { ...get().settings, ...s }
    set({ settings })
    try { localStorage.setItem('crypt_settings', JSON.stringify(settings)) } catch {}
  },

  hydrate: async () => {
    if (typeof window === 'undefined') return
    try {
      const settingsRaw = localStorage.getItem('crypt_settings')
      if (settingsRaw) {
        const saved = JSON.parse(settingsRaw)
        set({ settings: { ...get().settings, ...saved } })
      }

      const stateRaw = localStorage.getItem('crypt_state')
      let messages: Record<string, Message[]> = {}
      if (stateRaw) {
        const saved = JSON.parse(stateRaw)
        messages = saved.messages || {}
        set({
          contacts: saved.contacts || [],
          contactRequests: saved.contactRequests || [],
          conversations: saved.conversations || [],
          messages,
        })
      }

      // Identity: only the PUBLIC half lives in localStorage. The private key
      // is a non-extractable CryptoKey handle kept in IndexedDB.
      const raw = localStorage.getItem('crypt_identity')
      const privateKey = await loadPrivateKey()
      if (raw && privateKey) {
        const parsed = JSON.parse(raw)
        const user = parsed.user
        const publicKey = parsed.publicKey || user?.publicKey || ''
        const fingerprint = parsed.fingerprint || user?.publicKeyFingerprint || ''
        if (user && publicKey) {
          set({
            user,
            keyPair: { publicKey, privateKey, fingerprint },
            isAuthenticated: true,
          })
          // Re-decrypt persisted ciphertexts into memory only.
          const rebuilt: Record<string, Message[]> = {}
          for (const [cid, list] of Object.entries(messages)) {
            rebuilt[cid] = await Promise.all(list.map(async (m) => {
              if (!m.encrypted || !m.encryptedKey || !m.iv) return m
              try {
                const plainContent = await decryptMessage(m.iv, m.encryptedKey, m.content, privateKey)
                return { ...m, plainContent }
              } catch { return m }
            }))
          }
          set({ messages: rebuilt })
          // Honor disappearing-message TTL for messages restored from storage.
          for (const [cid, list] of Object.entries(rebuilt)) {
            for (const m of list) scheduleDisappear(cid, m)
          }
        }
      }
    } catch {}
    set({ hydrated: true })
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('crypt_identity')
      localStorage.removeItem('crypt_token')
      localStorage.removeItem('crypt_state')
    }
    void clearPrivateKey()
    api.clearToken()
    set({
      user: null, keyPair: null, isAuthenticated: false,
      contacts: [], contactRequests: [], conversations: [],
      activeConversationId: null, messages: {},
    })
  },
}))
