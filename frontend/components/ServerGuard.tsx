'use client'

import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { ServerOff, RefreshCw } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'

export function ServerGuard({ children }: { children: React.ReactNode }) {
  const serverAvailable = useStore((s) => s.serverAvailable)
  const setServerAvailable = useStore((s) => s.setServerAvailable)

  const check = () => {
    api.health()
      .then(() => setServerAvailable(true))
      .catch(() => setServerAvailable(false))
  }

  useEffect(() => {
    check()
    const iv = setInterval(check, 10000)
    return () => clearInterval(iv)
  }, [])

  const checking = serverAvailable === null
  const offline = serverAvailable === false

  if (offline || checking) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: '#120c0a' }}>
        <GlassCard variant="neon" hover={false} className="p-8 max-w-sm text-center">
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <ServerOff size={48} className="text-rose-500 mx-auto mb-4" />
          </motion.div>
          <h2 className="text-lg font-semibold text-[#f5e6d3] mb-2">
            {checking ? 'Connecting to server...' : 'Server offline'}
          </h2>
          <p className="text-sm text-gray-400 mb-6">
            {checking
              ? 'Attempting to connect to the CRYPTMessenger server...'
              : 'The CRYPTMessenger server is unreachable.\nAutomatic checks every 10s.'}
          </p>
          {offline && (
            <GlassButton variant="primary" onClick={check} icon={<RefreshCw size={14} />}>
              Check again
            </GlassButton>
          )}
        </GlassCard>
      </div>
    )
  }

  return <>{children}</>
}
