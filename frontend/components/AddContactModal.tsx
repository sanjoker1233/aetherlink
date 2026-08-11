'use client'

import { useId, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Link, Key, User, AlertCircle, Check } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput } from '@/components/ui/GlassInput'
import { useStore } from '@/lib/store'
import { wsManager } from '@/lib/ws-client'
import { parseIdentityURI } from '@/lib/e2e'
import { api } from '@/lib/api'
import { useDialogA11y } from '@/lib/useDialogA11y'

interface Props {
  open: boolean
  onClose: () => void
}

type Mode = 'link' | 'manual'

export function AddContactModal({ open, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('link')
  const [input, setInput] = useState('')
  const [name, setName] = useState('')
  const [fp, setFp] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const { user } = useStore()
  const headingId = useId()
  const dialogRef = useDialogA11y(open, onClose)

  const reset = () => {
    setInput(''); setName(''); setFp(''); setError(''); setSuccess('')
  }

  const handleParse = async () => {
    setError(''); setSuccess('')
    const trimmed = input.trim()
    const parsed = parseIdentityURI(trimmed)
    if (parsed) {
      await lookupAndSend(parsed.name, parsed.fp, parsed.key)
      return
    }
    if (/^[0-9A-Fa-f]{32}$/.test(trimmed)) {
      setFp(trimmed.toUpperCase())
      setMode('manual')
      return
    }
    setError('Unrecognized format. Use a CRYPTMessenger link or a fingerprint.')
  }

  const lookupAndSend = async (displayName: string, fpH: string, targetPubKey: string) => {
    try {
      const users = await api.lookup(fpH)
      if (users && users.length > 0) {
        if (!user) return
        wsManager.sendContactRequest(users[0].userId)
        setSuccess(`Contact request sent to ${displayName || users[0].displayName}`)
        setTimeout(() => { reset(); onClose() }, 2000)
      } else {
        setError('User not found (offline or unknown fingerprint)')
      }
    } catch {
      setError('Search error. Check that the backend is reachable.')
    }
  }

  const handleManual = async () => {
    setError('')
    if (!fp.trim() || !/^[0-9A-Fa-f]{32}$/.test(fp.trim())) {
      setError('Invalid fingerprint (32 hex characters)'); return
    }
    await lookupAndSend(name.trim(), fp.trim().toUpperCase(), '')
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            tabIndex={-1}
            initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md"
          >
            <GlassCard hover={false} className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 id={headingId} className="text-lg font-semibold neon-text">Add a contact</h2>
                <button onClick={onClose} aria-label="Close dialog" className="text-gray-400 hover:text-white"><X size={20} /></button>
              </div>

              <div className="flex gap-2 mb-4">
                {([
                  ['link', 'Link'],
                  ['manual', 'Manual'],
                ] as [Mode, string][]).map(([m, label]) => (
                  <GlassButton
                    key={m}
                    variant={mode === m ? 'primary' : 'ghost'}
                    size="sm"
                    className="flex-1"
                    onClick={() => { setMode(m); setError(''); setSuccess('') }}
                    icon={m === 'link' ? <Link size={14} /> : <Key size={14} />}
                  >
                    {label}
                  </GlassButton>
                ))}
              </div>

              {mode === 'link' && (
                <div className="space-y-3">
                  <GlassInput
                    placeholder="Paste the CRYPTMessenger link or fingerprint..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    icon={<Link size={16} />}
                  />
                  <GlassButton variant="primary" size="md" className="w-full" onClick={handleParse}>
                    Parse & send
                  </GlassButton>
                </div>
              )}

              {mode === 'manual' && (
                <div className="space-y-3">
                  <GlassInput
                    placeholder="Contact name (optional)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    icon={<User size={16} />}
                  />
                  <GlassInput
                    placeholder="Fingerprint (32 hex characters)"
                    value={fp}
                    onChange={(e) => setFp(e.target.value.toUpperCase())}
                    icon={<Key size={16} />}
                    maxLength={32}
                  />
                  <GlassButton variant="primary" size="md" className="w-full" onClick={handleManual}>
                    Search & send
                  </GlassButton>
                </div>
              )}

              {error && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1 text-sm text-rose-400 mt-3">
                  <AlertCircle size={14} /> {error}
                </motion.p>
              )}
              {success && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1 text-sm text-emerald-400 mt-3">
                  <Check size={14} /> {success}
                </motion.p>
              )}
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
