'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { UserPlus, X, Check, User } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useStore } from '@/lib/store'
import { wsManager } from '@/lib/ws-client'

export function ContactRequestBadge() {
  const contactRequests = useStore((s) => s.contactRequests)
  const removeContactRequest = useStore((s) => s.removeContactRequest)

  if (contactRequests.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
      <AnimatePresence>
        {contactRequests.filter((r) => r.status === 'pending').map((req) => (
          <motion.div
            key={req.id}
            initial={{ opacity: 0, x: 100, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.9 }}
          >
            <GlassCard hover={false} variant="primary" className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-400/20 flex items-center justify-center shrink-0">
                  <UserPlus size={18} className="text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{req.fromName}</p>
                    <button onClick={() => removeContactRequest(req.id)} className="text-gray-500 hover:text-white">
                      <X size={14} />
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Fingerprint: {req.fromFingerprint}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Wants to add you as a contact
                  </p>
                  <div className="flex gap-2 mt-3">
                    <GlassButton
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        wsManager.acceptContact(req)
                      }}
                      icon={<Check size={12} />}
                    >
                      Accept
                    </GlassButton>
                    <GlassButton
                      variant="ghost"
                      size="sm"
                      onClick={() => removeContactRequest(req.id)}
                      icon={<X size={12} />}
                    >
                      Refuse
                    </GlassButton>
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
