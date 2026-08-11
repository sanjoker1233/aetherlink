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

  async getMessages(convID: string): Promise<any[]> {
    return this.request(`/api/messages/${convID}`)
  }

  async sendMessage(conversationId: string, senderId: string, content: string, encrypted: boolean, encryptedKey?: string, iv?: string): Promise<any> {
    return this.request('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ conversationId, senderId, content, encrypted, encryptedKey, iv, timestamp: Date.now() }),
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
