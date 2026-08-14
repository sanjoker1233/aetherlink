const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090'

export class CryptAPI {
  // SECURITY: the auth token lives in memory ONLY. Persisting it to
  // localStorage makes it trivially exfiltratable by any XSS. On reload the
  // user re-authenticates locally with their stored identity.
  private token: string | null = null

  setToken(token: string) {
    this.token = token
  }

  clearToken() {
    this.token = null
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }
    if (this.token) {
      headers['X-Crypt-Token'] = this.token
    }

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(err || `HTTP ${res.status}`)
    }
    return res.json()
  }

  async lookup(fingerprint: string): Promise<any[]> {
    return this.request(`/api/users/lookup?fp=${encodeURIComponent(fingerprint)}`)
  }

  async searchUsers(query: string): Promise<any[]> {
    return this.request(`/api/users/search?q=${encodeURIComponent(query)}`)
  }

  async health(): Promise<{ status: string; service: string; version: string }> {
    return this.request('/health')
  }

  async registerInit(displayName: string, publicKey: string): Promise<{
    pendingId: string; encryptedChallenge: string
  }> {
    return this.request('/api/auth/register-init', {
      method: 'POST',
      body: JSON.stringify({ displayName, publicKey }),
    })
  }

  async registerConfirm(pendingId: string, response: string): Promise<{
    userId: string; token: string; fingerprint: string
    displayName: string; publicKey: string
  }> {
    return this.request('/api/auth/register-confirm', {
      method: 'POST',
      body: JSON.stringify({ pendingId, response }),
    })
  }

  // Proof-of-possession login for an EXISTING identity (device recovery /
  // second device). Mirrors register but issues a token for the already
  // registered userID instead of minting a new one.
  async loginInit(publicKey: string): Promise<{ pendingId: string; encryptedChallenge: string }> {
    return this.request('/api/auth/login-init', {
      method: 'POST',
      body: JSON.stringify({ publicKey }),
    })
  }

  async loginConfirm(pendingId: string, response: string): Promise<{
    userId: string; token: string; fingerprint: string
    displayName: string; publicKey: string
  }> {
    return this.request('/api/auth/login-confirm', {
      method: 'POST',
      body: JSON.stringify({ pendingId, response }),
    })
  }

  async getNetworkStatus(): Promise<any> {
    return this.request('/api/network/status')
  }

  async getLoraStatus(): Promise<any> {
    return this.request('/api/lora/status')
  }

  async getLoraDevices(): Promise<any> {
    return this.request('/api/lora/devices')
  }

  async getMeshtasticStatus(): Promise<any> {
    return this.request('/api/meshtastic/status')
  }

  async getMeshtasticNodes(): Promise<any> {
    return this.request('/api/meshtastic/nodes')
  }

  // Fetch a conversation's history. Without params it returns the full thread
  // (backwards-compatible with existing callers). `limit` caps the page size and
  // `before` (unix-ms timestamp) returns only messages strictly older than it,
  // enabling cursor-based pagination from the UI (load older on scroll-to-top).
  async getMessages(convID: string, params?: { limit?: number; before?: number }): Promise<any[]> {
    let url = `/api/messages/${convID}`
    if (params) {
      const q = new URLSearchParams()
      if (params.limit) q.set('limit', String(params.limit))
      if (params.before) q.set('before', String(params.before))
      const s = q.toString()
      if (s) url += '?' + s
    }
    return this.request(url)
  }

  async sendMessage(conversationId: string, senderId: string, content: string, encrypted: boolean, encryptedKey?: string, iv?: string): Promise<any> {
    return this.request('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ conversationId, senderId, content, encrypted, encryptedKey, iv, timestamp: Date.now() }),
    })
  }

  async createConversation(members: string[], name?: string, type: 'dm' | 'group' = 'group'): Promise<any> {
    return this.request('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ members, name, type }),
    })
  }

  async listConversations(): Promise<any[]> {
    return this.request('/api/conversations')
  }

  async getVapidKey(): Promise<{ publicKey: string }> {
    return this.request('/api/push/vapid')
  }

  async subscribePush(sub: any): Promise<any> {
    return this.request('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(sub),
    })
  }

  getWSURL(): string {
    const base = API_BASE.replace(/^http/, 'ws')
    return `${base}/ws`
  }

  getToken(): string | null {
    return this.token
  }
}

export const api = new CryptAPI()
