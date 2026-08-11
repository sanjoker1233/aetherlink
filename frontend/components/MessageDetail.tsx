'use client'

import { useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Lock, Shield, Clock, User, Key, CheckCheck, AlertCircle, Send, FileText, Image, Trash2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { GlassButton } from '@/components/ui/GlassButton'
import { useDialogA11y } from '@/lib/useDialogA11y'

export function MessageDetail() {
  const selectedMessage = useStore((s) => s.selectedMessage)
  const user = useStore((s) => s.user)
  const setSelectedMessage = useStore((s) => s.setSelectedMessage)
  const conversations = useStore((s) => s.conversations)
  const removeMessage = useStore((s) => s.removeMessage)
  const headingId = useId()
  const dialogRef = useDialogA11y(!!selectedMessage, () => setSelectedMessage(null))

  if (!selectedMessage) return null

  const { msg, convId } = selectedMessage
  const conv = conversations.find((c) => c.id === convId)
  const isSent = msg.senderId === user?.id

  const statusLabel: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    sending: { label: 'Sending...', color: 'text-gray-500', icon: <Send size={12} /> },
    sent: { label: 'Sent', color: 'text-gray-400', icon: <CheckIcon size={12} /> },
    delivered: { label: 'Received', color: 'text-amber-400', icon: <CheckCheck size={12} /> },
    failed: { label: 'Failed', color: 'text-rose-400', icon: <AlertCircle size={12} /> },
  }
  const st = statusLabel[msg.status] || statusLabel.sent

  const hasAttachments = msg.content?.includes('[📷') || msg.content?.includes('[📎')

  const handleDelete = () => {
    removeMessage(convId, msg.id)
    setSelectedMessage(null)
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={() => setSelectedMessage(null)}
      >
        <motion.div
          initial={{ y: 200, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 200, opacity: 0 }}
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          tabIndex={-1}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-[#1c1611] border border-white/10 p-0 overflow-hidden shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h3 id={headingId} className="text-sm font-semibold text-amber-400">Message detail</h3>
            <button onClick={() => setSelectedMessage(null)} aria-label="Close dialog" className="text-gray-500 hover:text-white p-1">
              <X size={18} />
            </button>
          </div>

          <div className="p-4 max-h-[65vh] overflow-y-auto space-y-4">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Encrypted content</p>
              <div className="bg-[#2a201a] p-3 rounded-xl border border-amber-400/20">
                {msg.encrypted ? (
                  <div className="space-y-2">
                    <p className="text-xs text-amber-400/80 flex items-center gap-1.5">
                      <Lock size={12} /> AES-256-GCM encrypted message
                    </p>
                    <details className="text-[10px] text-gray-500 cursor-pointer">
                      <summary className="hover:text-gray-300">View ciphertext</summary>
                      <p className="mt-1 font-mono text-[10px] text-amber-400/50 break-all bg-black/20 p-2 rounded">{msg.content}</p>
                    </details>
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-[#f5e6d3]">{msg.content}</p>
                )}
              </div>
            </div>

            {hasAttachments && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Attachments</p>
                <div className="flex flex-wrap gap-2">
                  {msg.content.split('\n').filter(l => l.startsWith('[')).map((line, i) => (
                    <div key={i} className="bg-[#2a201a] p-2 flex items-center gap-2 text-xs rounded-lg">
                      {line.includes('📷') ? <Image size={14} className="text-amber-400" /> : <FileText size={14} className="text-orange-400" />}
                      {line.replace(/[[\]]/g, '')}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Encryption</p>
              <div className="bg-[#2a201a] p-3 space-y-2 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Algorithme</span>
                  <span className="text-xs font-medium flex items-center gap-1">
                    {msg.encrypted ? (
                      <><Lock size={11} className="text-amber-400" /> AES-256-GCM</>
                    ) : (
                      <><Shield size={11} className="text-gray-500" /> None</>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Key exchange</span>
                  <span className="text-xs font-medium flex items-center gap-1">
                    {msg.encrypted ? (
                      <><Key size={11} className="text-orange-400" /> RSA-4096</>
                    ) : (
                      '—'
                    )}
                  </span>
                </div>
                {msg.encrypted && msg.iv && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">IV</span>
                    <span className="text-[9px] font-mono text-gray-500 truncate max-w-[160px]">{msg.iv}</span>
                  </div>
                )}
                <div className={`text-[10px] px-2 py-1 rounded-full text-center ${msg.encrypted ? 'bg-amber-400/10 text-amber-400' : 'bg-gray-500/10 text-gray-500'}`}>
                  {msg.encrypted ? 'End-to-end encrypted ✓' : 'Not encrypted'}
                </div>
              </div>
            </div>

            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Metadata</p>
              <div className="bg-[#2a201a] p-3 space-y-2 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">From</span>
                  <span className="text-xs font-medium flex items-center gap-1">
                    <User size={11} className="text-gray-500" />
                    {isSent ? 'You' : conv?.name || 'Contact'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Status</span>
                  <span className={`text-xs font-medium flex items-center gap-1 ${st.color}`}>
                    {st.icon} {st.label}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Date</span>
                  <span className="text-xs font-medium flex items-center gap-1">
                    <Clock size={11} className="text-gray-500" />
                    {new Date(msg.timestamp).toLocaleString(undefined, {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">ID</span>
                  <span className="text-[9px] font-mono text-gray-500 truncate max-w-[120px]">{msg.id}</span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-white/5">
              <GlassButton
                variant="danger"
                size="sm"
                onClick={handleDelete}
                icon={<Trash2 size={14} />}
              >
                Delete this message
              </GlassButton>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function CheckIcon(props: any) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20,6 9,17 4,12" />
    </svg>
  )
}
