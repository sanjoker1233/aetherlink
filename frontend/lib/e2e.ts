import { openDB, type IDBPDatabase } from 'idb'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function ub64(s: string): ArrayBuffer {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer
}

// ---------------------------------------------------------------------------
// Key storage.
//
// The RSA private key is generated NON-EXTRACTABLE and never leaves the
// browser as bytes. We persist the opaque CryptoKey handle to IndexedDB via
// structured clone; even a full XSS cannot exfiltrate the key material.
// The public key (non sensitive) may live in localStorage.
// ---------------------------------------------------------------------------

const DB_NAME = 'cryptmessenger-keys'
const STORE = 'keys'
const KEY_ID = 'identity-private-key'

let dbPromise: Promise<IDBPDatabase> | null = null
function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)
      },
    })
  }
  return dbPromise
}

// In-memory handle (fast path, cleared on reload).
let memoryPrivateKey: CryptoKey | null = null

export async function savePrivateKey(key: CryptoKey): Promise<void> {
  memoryPrivateKey = key
  try {
    const d = await db()
    await d.put(STORE, key, KEY_ID)
  } catch {
    // IndexedDB unavailable (private mode): key stays in memory for this session.
  }
}

export async function loadPrivateKey(): Promise<CryptoKey | null> {
  if (memoryPrivateKey) return memoryPrivateKey
  try {
    const d = await db()
    const key = (await d.get(STORE, KEY_ID)) as CryptoKey | undefined
    memoryPrivateKey = key ?? null
    return memoryPrivateKey
  } catch {
    return null
  }
}

export async function clearPrivateKey(): Promise<void> {
  memoryPrivateKey = null
  try {
    const d = await db()
    await d.delete(STORE, KEY_ID)
  } catch {}
}

export async function generateE2EKeys(): Promise<{ publicKey: string; privateKey: CryptoKey }> {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    // extractable: false -> the private key can never be exported.
    // (WebCrypto applies extractability to the private key of the pair; the
    //  public key is still exportable via exportKey('spki').)
    false,
    ['encrypt', 'decrypt']
  )
  const publicKey = b64(await crypto.subtle.exportKey('spki', kp.publicKey))
  await savePrivateKey(kp.privateKey)
  return { publicKey, privateKey: kp.privateKey }
}

export async function fingerprint(pubKeyB64: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(pubKeyB64))
  const bytes = new Uint8Array(hash)
  // 128-bit fingerprint (16 bytes). Canonical key id used in lookups and as
  // half of the safety number. Far above the collision threshold.
  return Array.from(bytes.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

// decryptBytes runs the RSA-OAEP private-key operation and returns the raw
// plaintext bytes. Used for the register proof-of-possession challenge: the
// server encrypts a random nonce with our public key, we decrypt it with the
// private key and echo it back, proving we hold the key.
export async function decryptBytes(encryptedB64: string, privateKey: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, ub64(encryptedB64))
}

export function bytesToB64(buf: ArrayBuffer): string {
  return b64(buf)
}

// Safety number (Signal-style): hash of the sorted pair of fingerprints,
// rendered as 60 hex digits grouped by 4. Compare it out-of-band (call, in
// person) to detect a MITM or an unexpected key rotation.
export async function safetyNumber(myFp: string, theirFp: string): Promise<string> {
  const combined = [myFp, theirFp].sort().join('')
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(combined))
  const bytes = new Uint8Array(hash)
  const hex = Array.from(bytes.slice(0, 30))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
  return hex.match(/.{1,4}/g)!.join(' ')
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

/** Decrypt with a non-extractable CryptoKey handle (never a base64 secret). */
export async function decryptMessage(
  ivB64: string,
  encryptedKeyB64: string,
  cipherB64: string,
  privateKey: CryptoKey
): Promise<string> {
  const rawAes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, ub64(encryptedKeyB64))
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

// ---------------------------------------------------------------------------
// Encrypted identity backup / restore.
//
// The RSA private key is generated NON-EXTRACTABLE, so it can never be read
// back with exportKey(). We back it up with wrapKey(), which works on
// non-extractable keys: the key is encrypted under a passphrase-derived
// AES-256-GCM key and the resulting blob is written to disk. On restore we
// unwrap it back into a fresh non-extractable CryptoKey — the raw key bytes
// never exist in JS memory in cleartext. The rest of the bundle (public
// identity + local chat history) is non-sensitive: public keys and
// AES-encrypted ciphertexts only.
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 250_000

async function deriveWrapKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  )
  // Copy into a real ArrayBuffer so the salt satisfies BufferSource under TS
  // libs where Uint8Array is generic over ArrayBufferLike.
  const saltBytes = new Uint8Array(new ArrayBuffer(salt.length))
  saltBytes.set(salt)
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  )
}

export interface IdentityBackup {
  format: 'cryptmessenger-backup'
  version: 1
  createdAt: number
  key: { salt: string; iterations: number; iv: string; wrapped: string }
  identity: { publicKey: string; fingerprint: string; displayName?: string; userId?: string }
  data: {
    contacts?: any[]
    conversations?: any[]
    messages?: Record<string, any[]>
    contactRequests?: any[]
  }
}

export async function exportIdentityBackup(passphrase: string): Promise<string> {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters')
  }
  const privateKey = await loadPrivateKey()
  if (!privateKey) throw new Error('No private key to back up on this device')

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrapKey = await deriveWrapKey(passphrase, salt, PBKDF2_ITERATIONS)
  const wrapped = await crypto.subtle.wrapKey('pkcs8', privateKey, wrapKey, { name: 'AES-GCM', iv })

  const idRaw = localStorage.getItem('crypt_identity')
  const id = idRaw ? JSON.parse(idRaw) : {}
  const user = id.user || {}
  const stateRaw = localStorage.getItem('crypt_state')
  const state = stateRaw ? JSON.parse(stateRaw) : {}

  const backup: IdentityBackup = {
    format: 'cryptmessenger-backup',
    version: 1,
    createdAt: Date.now(),
    key: {
      salt: b64(salt.buffer),
      iterations: PBKDF2_ITERATIONS,
      iv: b64(iv.buffer),
      wrapped: b64(wrapped),
    },
    identity: {
      publicKey: id.publicKey || user.publicKey || '',
      fingerprint: id.fingerprint || user.publicKeyFingerprint || '',
      displayName: user.displayName,
      userId: user.id,
    },
    data: {
      contacts: state.contacts || [],
      conversations: state.conversations || [],
      messages: state.messages || {},
      contactRequests: state.contactRequests || [],
    },
  }
  return JSON.stringify(backup, null, 2)
}

export async function importIdentityBackup(
  json: string,
  passphrase: string
): Promise<{ privateKey: CryptoKey; publicKey: string; fingerprint: string }> {
  let backup: IdentityBackup
  try {
    backup = JSON.parse(json)
  } catch {
    throw new Error('Backup file is not valid JSON')
  }
  if (backup?.format !== 'cryptmessenger-backup') {
    throw new Error('This is not a CRYPTMessenger backup file')
  }
  const salt = new Uint8Array(ub64(backup.key.salt))
  const wrapKey = await deriveWrapKey(passphrase, salt, backup.key.iterations)
  let privateKey: CryptoKey
  try {
    privateKey = await crypto.subtle.unwrapKey(
      'pkcs8',
      ub64(backup.key.wrapped),
      wrapKey,
      { name: 'AES-GCM', iv: ub64(backup.key.iv) },
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    )
  } catch {
    throw new Error('Wrong passphrase or corrupted backup')
  }
  await savePrivateKey(privateKey)
  return {
    privateKey,
    publicKey: backup.identity.publicKey,
    fingerprint: backup.identity.fingerprint,
  }
}
