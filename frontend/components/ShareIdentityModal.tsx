'use client'

import { useRef, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Copy, Check, Share2, QrCode, Download } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useStore } from '@/lib/store'
import { identityURI } from '@/lib/e2e'
import { drawQRToCanvas } from '@/lib/qrcode'
import { useDialogA11y } from '@/lib/useDialogA11y'

interface Props {
  open: boolean
  onClose: () => void
}

export function ShareIdentityModal({ open, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { user, keyPair } = useStore()
  const [copied, setCopied] = useState(false)
  const headingId = useId()
  const dialogRef = useDialogA11y(open, onClose)

  const uri = user && keyPair
    ? identityURI(user.displayName, keyPair.publicKey, keyPair.fingerprint)
    : ''

  useEffect(() => {
    if (open && canvasRef.current && uri) {
      void drawQRToCanvas(canvasRef.current, uri, 240)
    }
  }, [open, uri])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(uri)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'CRYPTMessenger Identity', text: uri })
      } catch {}
    } else {
      handleCopy()
    }
  }

  const handleDownload = () => {
    if (!canvasRef.current) return
    const link = document.createElement('a')
    link.download = 'cryptmessenger-identity.png'
    link.href = canvasRef.current.toDataURL()
    link.click()
  }

  const [portalMounted, setPortalMounted] = useState(false)
  useEffect(() => setPortalMounted(true), [])
  if (!portalMounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
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
            className="w-full max-w-sm my-auto max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain"
          >
            <GlassCard hover={false} className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 id={headingId} className="text-lg font-semibold neon-text flex items-center gap-2">
                  <QrCode size={18} /> Share my identity
                </h2>
                <button onClick={onClose} aria-label="Close dialog" className="text-gray-400 hover:text-white">
                  <X size={20} />
                </button>
              </div>

              <div className="flex justify-center mb-4">
                <canvas
                  ref={canvasRef}
                  aria-label="QR code containing your identity link"
                  role="img"
                  className="rounded-xl shadow-neon w-[240px] max-w-full aspect-square h-auto"
                  width={240}
                  height={240}
                />
              </div>

              <div className="glass-panel p-3 mb-4">
                <p className="text-[10px] text-gray-500 mb-1">Fingerprint</p>
                <p className="text-sm font-mono text-amber-400 break-all">
                  {keyPair?.fingerprint || ''}
                </p>
              </div>

              <div className="glass-panel p-3 mb-4 max-h-32 overflow-y-auto">
                <p className="text-[10px] text-gray-500 mb-1">Invite link</p>
                <p className="text-xs text-gray-400 break-all font-mono">{uri}</p>
              </div>

              <div className="flex gap-2">
                <GlassButton variant="primary" size="sm" onClick={handleShare} className="flex-1" icon={<Share2 size={14} />}>
                  Share
                </GlassButton>
                <GlassButton variant="default" size="sm" onClick={handleCopy} className="flex-1" icon={copied ? <Check size={14} className="text-neon-green" /> : <Copy size={14} />}>
                  {copied ? 'Copied!' : 'Copy'}
                </GlassButton>
                <GlassButton variant="ghost" size="sm" onClick={handleDownload} icon={<Download size={14} />}>
                  QR
                </GlassButton>
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
