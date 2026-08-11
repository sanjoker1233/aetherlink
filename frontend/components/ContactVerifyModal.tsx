'use client'

import { useEffect, useState } from 'react'
import { useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ShieldCheck, Shield, Fingerprint } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useStore } from '@/lib/store'
import { safetyNumber } from '@/lib/e2e'
import { useDialogA11y } from '@/lib/useDialogA11y'
import type { Contact } from '@/lib/types'

interface Props {
  contact: Contact | null
  onClose: () => void
}

export function ContactVerifyModal({ contact, onClose }: Props) {
  const { user, setContactVerified } = useStore()
  const [sn, setSn] = useState('')
  const headingId = useId()
  const dialogRef = useDialogA11y(!!contact, onClose)

  useEffect(() => {
    if (!contact || !user) {
      setSn('')
      return
    }
    safetyNumber(user.publicKeyFingerprint, contact.publicKeyFingerprint)
      .then(setSn)
      .catch(() => setSn(''))
  }, [contact, user])

  return (
    <AnimatePresence>
      {contact && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            tabIndex={-1}
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md"
          >
            <GlassCard hover={false} className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 id={headingId} className="text-lg font-semibold neon-text">
                  Verify {contact.displayName}
                </h2>
                <button onClick={onClose} aria-label="Close dialog" className="text-gray-400 hover:text-white">
                  <X size={20} />
                </button>
              </div>

              <p className="text-xs text-gray-400 mb-1">Your fingerprint</p>
              <p className="text-sm font-mono text-amber-400 break-all mb-3 select-all">
                {user?.publicKeyFingerprint}
              </p>

              <p className="text-xs text-gray-400 mb-1">{contact.displayName}&apos;s fingerprint</p>
              <p className="text-sm font-mono text-amber-400 break-all mb-4 select-all">
                {contact.publicKeyFingerprint}
              </p>

              <p className="text-xs text-gray-400 mb-1">
                Safety number — compare it out-of-band (call, in person)
              </p>
              <p className="text-base font-mono text-[#f5e6d3] tracking-wider break-all mb-4 select-all">
                {sn || '…'}
              </p>

              <GlassButton
                variant={contact.verified ? 'ghost' : 'primary'}
                size="md"
                className="w-full"
                onClick={() => {
                  setContactVerified(contact.userId, !contact.verified)
                  onClose()
                }}
                icon={contact.verified ? <Shield size={16} /> : <ShieldCheck size={16} />}
              >
                {contact.verified ? 'Remove verification' : 'Mark as verified'}
              </GlassButton>

              <p className="text-[10px] text-gray-500 mt-3 leading-relaxed">
                Verifying pins {contact.displayName}&apos;s public key to this identity. If the safety
                number ever changes, treat it as a possible key rotation or a man-in-the-middle attack.
              </p>
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
