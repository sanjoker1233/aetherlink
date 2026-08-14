'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Lock, Key, User, Shield, Wifi, Download } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput } from '@/components/ui/GlassInput'
import { useStore } from '@/lib/store'
import { CryptCrypto } from '@/lib/crypto'
import { api } from '@/lib/api'
import { loadPrivateKey, decryptBytes, bytesToB64 } from '@/lib/e2e'
import { restoreFromBackup } from '@/lib/backup'
import type { User as UserType, AuthKeyPair } from '@/lib/types'

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [displayName, setDisplayName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const { setUser, setKeyPair, setAuthenticated } = useStore()

  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restorePass, setRestorePass] = useState('')
  const [restoreStatus, setRestoreStatus] = useState('')

  useEffect(() => {
    api.health().then(() => setBackendOk(true)).catch(() => setBackendOk(false))
  }, [])

  const handleRegister = async () => {
    const name = displayName.trim()
    if (!name) { setError('Please enter a name'); return }
    setIsLoading(true); setError('')

    try {
      const { publicKey, privateKey } = await CryptCrypto.generateKeyPair()
      const fp = await CryptCrypto.fingerprint(publicKey)

      const kp: AuthKeyPair = { publicKey, privateKey, fingerprint: fp }
      let userId = CryptCrypto.generateId()
      let registered = false
      let registerErr = ''

      try {
        // Two-step register with proof-of-possession:
        //  1) the server encrypts a random nonce with our public key
        //  2) we decrypt it with the private key and echo it back.
        // This proves we actually hold the private key before an identity is minted.
        const init = await api.registerInit(name, publicKey)
        const raw = await decryptBytes(init.encryptedChallenge, privateKey)
        const response = bytesToB64(raw)
        const res = await api.registerConfirm(init.pendingId, response)
        userId = res.userId
        api.setToken(res.token)
        registered = true
      } catch (e: any) {
        // Keep the real server rejection (e.g. "display name already taken")
        // so we can surface it instead of a generic "unreachable" message.
        registerErr = e?.message || ''
      }

      const user: UserType = {
        id: userId,
        displayName: name,
        publicKey,
        publicKeyFingerprint: fp,
        status: 'online',
      }

      setKeyPair(kp); setUser(user); setAuthenticated(true)
      // SECURITY: only the PUBLIC half of the identity is persisted. The RSA
      // private key is a non-extractable CryptoKey stored in IndexedDB by
      // lib/e2e.ts, and the auth token stays in memory only.
      localStorage.setItem('crypt_identity', JSON.stringify({
        user, publicKey, fingerprint: fp,
      }))
      if (!registered) {
        // The key-pair was generated and stored locally, but the server-side
        // registration did not complete. Distinguish a real rejection (e.g.
        // duplicate display name) from a genuine connectivity problem so the
        // user gets an actionable message instead of always "unreachable".
        const m = registerErr.match(/error"\s*:\s*"([^"]+)"/i)
        const reason = m ? m[1] : ''
        if (reason) {
          setError(reason.charAt(0).toUpperCase() + reason.slice(1))
        } else {
          setError("Account created locally. Backend unreachable — others won't be able to find you while the server is offline.")
        }
      }
    } catch (err) {
      setError('Error generating keys')
    }
    setIsLoading(false)
  }

  const handleLogin = async () => {
    const stored = localStorage.getItem('crypt_identity')
    if (!stored) { setError('No identity found. Create an account.'); return }
    try {
      const parsed = JSON.parse(stored)
      const user = parsed.user
      const publicKey = parsed.publicKey || user?.publicKey || ''
      const fp = parsed.fingerprint || user?.publicKeyFingerprint || ''
      const privateKey = await loadPrivateKey()
      if (!privateKey) {
        setError('Private key not found on this device. Create a new identity.')
        return
      }

      // Re-authenticate with the server via proof-of-possession login so we get
      // a fresh token for the existing identity (the JWT is not persisted).
      try {
        const init = await api.loginInit(publicKey)
        const raw = await decryptBytes(init.encryptedChallenge, privateKey)
        const response = bytesToB64(raw)
        const res = await api.loginConfirm(init.pendingId, response)
        api.setToken(res.token)
      } catch {
        // Backend unreachable: stay authenticated locally (offline).
      }

      setKeyPair({ publicKey, privateKey, fingerprint: fp })
      setUser(user)
      setAuthenticated(true)
    } catch {
      setError('Corrupt identity data')
    }
  }

  const handleRestore = async () => {
    if (!restoreFile) { setError('Choose a backup file first'); return }
    setIsLoading(true); setError(''); setRestoreStatus('')
    try {
      const text = await restoreFile.text()
      const res = await restoreFromBackup(text, restorePass)
      setRestoreStatus(res.offline
        ? 'Restored locally. Server unreachable — history is readable, but you are not discoverable until it returns.'
        : 'Identity and history restored.')
    } catch (e: any) {
      setError(e?.message || 'Restore failed')
    }
    setIsLoading(false)
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <GlassCard variant="neon" hover={false} className="p-8">
          <div className="text-center mb-8">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
              className="w-16 h-16 rounded-2xl bg-gradient-to-br from-neon-cyan via-neon-violet to-neon-magenta flex items-center justify-center mx-auto mb-4"
            >
              <Lock size={28} className="text-white" />
            </motion.div>
            <h1 className="text-2xl font-bold neon-text mb-1">CRYPTMessenger</h1>
            <p className="text-sm text-gray-400">
              End-to-end encrypted communication
            </p>
            {backendOk !== null && (
              <div className={`flex items-center justify-center gap-1.5 mt-2 ${backendOk ? 'text-emerald-500' : 'text-rose-500'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${backendOk ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <span className="text-[10px]">{backendOk ? 'Server connected' : 'Server unreachable'}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2 mb-6">
            <GlassButton variant={mode === 'register' ? 'primary' : 'ghost'} size="sm" onClick={() => setMode('register')} className="flex-1">
              <User size={14} /> Nouveau
            </GlassButton>
            <GlassButton variant={mode === 'login' ? 'primary' : 'ghost'} size="sm" onClick={() => setMode('login')} className="flex-1">
              <Key size={14} /> Sign in
            </GlassButton>
          </div>

          {mode === 'register' ? (
            <div className="space-y-4">
              <GlassInput
                label="Username"
                placeholder="Your identity"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                icon={<User size={16} />}
                error={error}
              />
              <div className="glass-panel p-3 text-xs text-gray-400 flex items-start gap-2">
                <Shield size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <p>RSA-4096 key generated locally. Your private key never leaves this device.</p>
              </div>
              <div className="glass-panel p-3 text-xs text-gray-400 flex items-start gap-2">
                <Wifi size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <p>Offline mode available. Messages are encrypted and stored locally.</p>
              </div>
              <GlassButton variant="primary" size="lg" onClick={handleRegister} disabled={isLoading} className="w-full">
                {isLoading ? 'Generating keys...' : 'Create my encrypted identity'}
              </GlassButton>
            </div>
          ) : (
            <div className="space-y-4">
              <GlassButton variant="primary" size="lg" onClick={handleLogin} className="w-full">
                <Key size={16} /> Sign in with my keys
              </GlassButton>
              <GlassButton variant="ghost" size="sm" onClick={() => setRestoreOpen((v) => !v)} className="w-full">
                <Download size={14} /> Restore from backup
              </GlassButton>
              {restoreOpen && (
                <div className="glass-panel p-3 space-y-3">
                  <input type="file" accept="application/json,.json" onChange={(e) => setRestoreFile(e.target.files?.[0] || null)} className="text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-amber-400/20 file:text-amber-400 file:text-xs" />
                  <input type="password" placeholder="Backup passphrase" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-200 outline-none focus:border-amber-400/40" />
                  <GlassButton variant="primary" size="sm" onClick={handleRestore} disabled={isLoading} className="w-full">
                    {isLoading ? 'Restoring...' : 'Restore identity'}
                  </GlassButton>
                  {restoreStatus && <p className="text-[11px] text-emerald-400">{restoreStatus}</p>}
                  {error && <p className="text-[11px] text-rose-400">{error}</p>}
                </div>
              )}
              {error && !restoreOpen && <p className="text-sm text-red-400 text-center">{error}</p>}
            </div>
          )}

            <div className="mt-6 pt-4 border-t border-white/5 text-center">
            <p className="text-[10px] text-gray-600">RSA-4096 + AES-256-GCM encryption • E2EE</p>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  )
}
