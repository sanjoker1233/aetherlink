'use client'

import { create } from 'zustand'
import type {
  User, Contact, Message, Conversation, NetworkType,
  MeshNetwork, NetworkNode, AuthKeyPair, AppSettings, TabType, ContactRequest,
} from './types'
import { api } from './api'

interface AppState {
  user: User | null
  keyPair: AuthKeyPair | null
  isAuthenticated: boolean

  contacts: Contact[]
  contactRequests: ContactRequest[]
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
  settings: AppSettings

  setServerAvailable: (v: boolean | null) => void
  setUser: (u: User | null) => void
  setKeyPair: (kp: AuthKeyPair | null) => void
  setAuthenticated: (v: boolean) => void

  setContacts: (c: Contact[]) => void
  addContact: (c: Contact) => void
  removeContact: (id: string) => void

  setContactRequests: (r: ContactRequest[]) => void
  addContactRequest: (r: ContactRequest) => void
  removeContactRequest: (id: string) => void

  setConversations: (c: Conversation[]) => void
  addConversation: (c: Conversation) => void
  setActiveConversation: (id: string | null) => void
  setSelectedMessage: (sel: { convId: string; msg: Message } | null) => void
  markConversationRead: (id: string) => void

  addMessage: (convId: string, msg: Message) => void
  updateMessageStatus: (msgId: string, status: Message['status']) => void
  removeMessage: (convId: string, msgId: string) => void

  setMeshNetwork: (n: MeshNetwork) => void
  updateNetworkNode: (n: NetworkNode) => void
  setActiveNetwork: (t: NetworkType) => void
  setNetworkStrength: (s: number) => void

  setActiveTab: (t: TabType) => void
  setSidebarOpen: (v: boolean) => void
  updateSettings: (s: Partial<AppSettings>) => void
  hydrate: () => void
  logout: () => void
}

const defaultSettings: AppSettings = {
  theme: 'dark', preferredNetwork: 'hybrid', autoSwitchNetwork: true,
  encryptionEnabled: true, notificationsEnabled: true, offlineMode: false,
  decryptDuration: 0,
}

const saveToStorage = (data: Partial<AppState>) => {
  if (typeof window === 'undefined') return
  try {
    const toSave: any = {}
    if (data.contacts) toSave.contacts = data.contacts
    if (data.conversations) toSave.conversations = data.conversations
    if (data.messages) toSave.messages = data.messages
    if (data.contactRequests) toSave.contactRequests = data.contactRequests
    localStorage.setItem('crypt_state', JSON.stringify(toSave))
  } catch {}
}

function initFromStorage() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem('crypt_identity')
    if (raw) {
      const { user, keyPair, token } = JSON.parse(raw)
      if (user && keyPair) {
        if (token) api.setToken(token)
        return { user, keyPair, isAuthenticated: true }
      }
    }
  } catch {}
  return {}
}

function initStateFromStorage() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem('crypt_state')
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function initSettingsFromStorage() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem('crypt_settings')
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

const initial = initFromStorage()
const initialSaved = initStateFromStorage()
const initialSettings = initSettingsFromStorage()

export const useStore = create<AppState>((set, get) => ({
  user: initial.user || null,
  keyPair: initial.keyPair || null,
  isAuthenticated: initial.isAuthenticated || false,

  contacts: initialSaved.contacts || [],
  contactRequests: initialSaved.contactRequests || [],
  conversations: initialSaved.conversations || [],
  activeConversationId: null,
  selectedMessage: null,
  messages: initialSaved.messages || {},

  meshNetwork: { nodes: [], links: [], activeType: 'internet', isSimulated: false },
  activeNetwork: 'internet',
  networkStrength: 100,
  serverAvailable: null,
  activeTab: 'chats',
  isSidebarOpen: true,
  settings: { ...defaultSettings, ...initialSettings },

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

  setContactRequests: (r) => set({ contactRequests: r }),
  addContactRequest: (r) => {
    const contactRequests = [...get().contactRequests, r]
    set({ contactRequests }); saveToStorage({ contactRequests })
  },
  removeContactRequest: (id) => {
    const contactRequests = get().contactRequests.filter((c) => c.id !== id)
    set({ contactRequests }); saveToStorage({ contactRequests })
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
  },
  updateMessageStatus: (msgId, status) => {
    const messages = { ...get().messages }
    for (const key of Object.keys(messages)) {
      messages[key] = messages[key].map((m) => m.id === msgId ? { ...m, status } : m)
    }
    set({ messages }); saveToStorage({ messages })
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
  updateSettings: (s) => {
    const settings = { ...get().settings, ...s }
    set({ settings })
    try { localStorage.setItem('crypt_settings', JSON.stringify(settings)) } catch {}
  },

  hydrate: () => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem('crypt_identity')
      if (raw) {
        const { user, keyPair, token } = JSON.parse(raw)
        if (user && keyPair) {
          if (token) api.setToken(token)
          set({ user, keyPair, isAuthenticated: true })
        }
      }
      const stateRaw = localStorage.getItem('crypt_state')
      if (stateRaw) {
        const saved = JSON.parse(stateRaw)
        set({
          contacts: saved.contacts || [],
          contactRequests: saved.contactRequests || [],
          conversations: saved.conversations || [],
          messages: saved.messages || {},
        })
      }
      const settingsRaw = localStorage.getItem('crypt_settings')
      if (settingsRaw) {
        const saved = JSON.parse(settingsRaw)
        set({ settings: { ...get().settings, ...saved } })
      }
    } catch {}
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('crypt_identity')
      localStorage.removeItem('crypt_token')
      localStorage.removeItem('crypt_state')
    }
    api.clearToken()
    set({
      user: null, keyPair: null, isAuthenticated: false,
      contacts: [], contactRequests: [], conversations: [],
      activeConversationId: null, messages: {},
    })
  },
}))
