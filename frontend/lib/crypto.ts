import { fingerprint as e2eFingerprint, generateE2EKeys } from './e2e'

export class CryptCrypto {
  static async generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    return generateE2EKeys()
  }

  static async fingerprint(publicKey: string): Promise<string> {
    return e2eFingerprint(publicKey)
  }

  static generateId(): string {
    return generateId()
  }
}

export function generateId(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}
