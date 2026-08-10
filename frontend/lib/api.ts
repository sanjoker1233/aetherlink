const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090'

export class CryptAPI {
  private token: string | null = null

  constructor() {
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('crypt_token')
    }
  }

  setToken(token: string) {
    this.token = token
    if (typeof window !== 'undefined') {
      localStorage.setItem('crypt_token', token)
    }
  }

  clearToken() {
    this.token = null
    if (typeof window !== 'undefined') {
      localStorage.removeItem('crypt_token')
    }
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

  async register(displayName: string, publicKey: string): Promise<{
    userId: string; token: string; fingerprint: string
  }> {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ displayName, publicKey }),
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
