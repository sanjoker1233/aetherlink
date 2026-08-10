'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Lock, Key, User, Shield, Wifi } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput } from '@/components/ui/GlassInput'
import { useStore } from '@/lib/store'
import { CryptCrypto } from '@/lib/crypto'
import { api } from '@/lib/api'
import type { User as UserType, AuthKeyPair } from '@/lib/types'

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [displayName, setDisplayName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const { setUser, setKeyPair, setAuthenticated } = useStore()

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
      let token = ''
      let registered = false

      try {
        const res = await api.register(name, publicKey)
        userId = res.userId
        token = res.token
        api.setToken(token)
        registered = true
      } catch {
      }

      const user: UserType = {
        id: userId,
        displayName: name,
        publicKey,
        publicKeyFingerprint: fp,
        status: 'online',
      }

      setKeyPair(kp); setUser(user); setAuthenticated(true)
      localStorage.setItem('crypt_identity', JSON.stringify({ keyPair: kp, user, token }))
      if (!registered) setError('Account created locally. Backend unreachable — others won't be able to find you while the server is offline.')
    } catch (err) {
      setError('Error generating keys')
    }
    setIsLoading(false)
  }

  const handleLogin = () => {
    const stored = localStorage.getItem('crypt_identity')
    if (!stored) { setError('No identity found. Create an account.'); return }
    try {
      const { keyPair, user, token } = JSON.parse(stored)
      setKeyPair(keyPair); setUser(user); setAuthenticated(true)
      if (token) api.setToken(token)
    } catch {
      setError('Données d\'identité corrompues')
    }
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
              <Key size={14} /> Connexion
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
              {error && <p className="text-sm text-red-400 text-center">{error}</p>}
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
