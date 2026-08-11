import { importIdentityBackup, decryptBytes, bytesToB64 } from './e2e'
import { api } from './api'
import { useStore } from './store'
import type { User } from './types'

export interface RestoreResult {
  offline: boolean
  displayName: string
}

// Restore an identity + local chat history from an encrypted backup.
// The private key is unwrapped (never exposed in cleartext), then we
// re-authenticate with the server via proof-of-possession login to obtain a
// fresh token for the EXISTING identity. If the server is unreachable we fall
// back to an offline identity (history readable, but not discoverable).
export async function restoreFromBackup(json: string, passphrase: string): Promise<RestoreResult> {
  const { privateKey, publicKey, fingerprint } = await importIdentityBackup(json, passphrase)
  const backup = JSON.parse(json)
  const data = backup.data || {}

  let offline = false
  let displayName = backup.identity?.displayName || 'Recovered'
  let userID = backup.identity?.userId || ''
  try {
    const init = await api.loginInit(publicKey)
    const raw = await decryptBytes(init.encryptedChallenge, privateKey)
    const response = bytesToB64(raw)
    const res = await api.loginConfirm(init.pendingId, response)
    api.setToken(res.token)
    userID = res.userId
    displayName = res.displayName
  } catch {
    offline = true
  }

  const user: User = {
    id: userID,
    displayName,
    publicKey,
    publicKeyFingerprint: fingerprint,
    status: 'online',
  }

  const store = useStore.getState()
  store.setKeyPair({ publicKey, privateKey, fingerprint })
  store.setUser(user)
  store.setAuthenticated(true)
  localStorage.setItem('crypt_identity', JSON.stringify({ user, publicKey, fingerprint }))

  if (data.contacts) store.setContacts(data.contacts)
  if (data.conversations) store.setConversations(data.conversations)
  if (data.contactRequests) store.setContactRequests(data.contactRequests)
  if (data.messages) {
    const prev = useStore.getState().messages
    const merged = { ...prev, ...data.messages }
    useStore.setState({ messages: merged })
    try {
      const raw = localStorage.getItem('crypt_state')
      const parsed = raw ? JSON.parse(raw) : {}
      parsed.messages = merged
      parsed.contacts = data.contacts || parsed.contacts
      parsed.conversations = data.conversations || parsed.conversations
      parsed.contactRequests = data.contactRequests || parsed.contactRequests
      localStorage.setItem('crypt_state', JSON.stringify(parsed))
    } catch {}
  }

  if (!offline && !userID) offline = true
  return { offline, displayName }
}
