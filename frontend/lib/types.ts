export interface User {
  id: string
  displayName: string
  publicKey: string
  publicKeyFingerprint: string
  avatar?: string
  status: 'online' | 'offline' | 'mesh'
  lastSeen?: number
  network?: NetworkType
}

export interface Contact {
  id: string
  userId: string
  displayName: string
  publicKey: string
  publicKeyFingerprint: string
  avatar?: string
  status: 'online' | 'offline' | 'mesh'
  lastSeen?: number
  network?: NetworkType
  createdAt: number
}

export interface ContactRequest {
  id: string
  fromUserId: string
  fromName: string
  fromFingerprint: string
  fromPublicKey: string
  status: 'pending' | 'accepted' | 'rejected'
  timestamp: number
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  content: string
  plainContent?: string
  encrypted: boolean
  encryptedKey?: string
  iv?: string
  timestamp: number
  status: 'sending' | 'sent' | 'delivered' | 'failed'
  networkRoute?: NetworkType[]
  replyTo?: string
}

export interface Conversation {
  id: string
  participants: string[]
  name?: string
  lastMessage?: Message
  unreadCount: number
  encryptionEnabled: boolean
  networkPreference: NetworkType
  updatedAt: number
}

export type NetworkType = 'internet' | 'lora' | 'mesh' | 'satellite' | 'hybrid' | 'wifi'

export interface NetworkNode {
  id: string
  name: string
  type: 'gateway' | 'repeater' | 'client'
  network: NetworkType
  strength: number
  lat?: number; lng?: number
  status: 'online' | 'offline' | 'degraded'
  lastHeard: number; hops: number; battery?: number
}

export interface NetworkLink {
  source: string; target: string; type: NetworkType
  quality: number; latency: number
}

export interface MeshNetwork {
  nodes: NetworkNode[]; links: NetworkLink[]
  activeType: NetworkType; isSimulated: boolean
}

export interface AuthKeyPair {
  publicKey: string; privateKey: string; fingerprint: string
}

export interface AppSettings {
  theme: 'dark' | 'light'
  preferredNetwork: NetworkType
  autoSwitchNetwork: boolean
  encryptionEnabled: boolean
  notificationsEnabled: boolean
  offlineMode: boolean
  decryptDuration: number
}

export type TabType = 'chats' | 'contacts' | 'network' | 'settings'
