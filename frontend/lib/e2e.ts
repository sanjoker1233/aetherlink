const encoder = new TextEncoder()
const decoder = new TextDecoder()

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function ub64(s: string): ArrayBuffer {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer
}

export async function generateE2EKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']
  )
  return {
    publicKey: b64(await crypto.subtle.exportKey('spki', kp.publicKey)),
    privateKey: b64(await crypto.subtle.exportKey('pkcs8', kp.privateKey)),
  }
}

export async function fingerprint(pubKeyB64: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(pubKeyB64))
  const bytes = new Uint8Array(hash)
  return Array.from(bytes.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

export async function encryptMessage(
  plain: string,
  recipientPubKeyB64: string
): Promise<{ iv: string; encryptedKey: string; ciphertext: string }> {
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const ivArr = crypto.getRandomValues(new Uint8Array(12))
  const encoded = encoder.encode(plain)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivArr }, aesKey, encoded)

  const rawAes = await crypto.subtle.exportKey('raw', aesKey)
  const pub = await crypto.subtle.importKey(
    'spki', ub64(recipientPubKeyB64),
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']
  )
  const ek = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, rawAes)

  return { iv: b64(ivArr.buffer), encryptedKey: b64(ek), ciphertext: b64(ct) }
}

export async function decryptMessage(
  ivB64: string,
  encryptedKeyB64: string,
  cipherB64: string,
  privateKeyB64: string
): Promise<string> {
  const priv = await crypto.subtle.importKey(
    'pkcs8', ub64(privateKeyB64),
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']
  )
  const rawAes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, priv, ub64(encryptedKeyB64))
  const aesKey = await crypto.subtle.importKey('raw', rawAes, { name: 'AES-GCM' }, false, ['decrypt'])
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64(ivB64) }, aesKey, ub64(cipherB64))
  return decoder.decode(pt)
}

export function identityURI(name: string, pubKey: string, fp: string): string {
  return `cryptm://add?name=${encodeURIComponent(name)}&key=${encodeURIComponent(pubKey)}&fp=${fp}`
}

export function parseIdentityURI(uri: string): { name: string; key: string; fp: string } | null {
  try {
    const u = new URL(uri)
    if (u.protocol !== 'cryptm:' || u.host !== 'add') return null
    const name = u.searchParams.get('name') || ''
    const key = u.searchParams.get('key') || ''
    const fp = u.searchParams.get('fp') || ''
    if (!key || !fp) return null
    return { name, key, fp }
  } catch { return null }
}
