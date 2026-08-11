'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { clsx } from 'clsx'
import { Radio, Satellite, Wifi, Signal } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import type { NetworkType } from '@/lib/types'

const networkConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  internet: { label: 'Internet', icon: <Wifi size={14} />, color: 'bg-neon-blue' },
  lora: { label: 'LoRaWAN', icon: <Radio size={14} />, color: 'bg-neon-green' },
  mesh: { label: 'Mesh', icon: <Radio size={14} />, color: 'bg-neon-violet' },
  satellite: { label: 'Satellite', icon: <Satellite size={14} />, color: 'bg-neon-amber' },
  hybrid: { label: 'Hybrid', icon: <Signal size={14} />, color: 'bg-gradient-to-r from-neon-cyan via-neon-violet to-neon-magenta' },
  wifi: { label: 'WiFi', icon: <Wifi size={14} />, color: 'bg-neon-blue' },
}

export function NetworkBar() {
  const { activeNetwork, networkStrength, meshNetwork } = useStore()
  const net = networkConfig[activeNetwork]

  const [backendOk, setBackendOk] = useState<boolean | null>(null)

  useEffect(() => {
    const check = () => {
      // Use the shared API client so NEXT_PUBLIC_API_URL (and the CSP
      // connect-src allowlist) are respected instead of a hardcoded origin.
      api.health()
        .then(() => setBackendOk(true))
        .catch(() => setBackendOk(false))
    }
    check()
    const iv = setInterval(check, 15000)
    return () => clearInterval(iv)
  }, [])

  return (
    <motion.div
      initial={{ y: -30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="glass-panel mx-2 mt-2 px-4 py-2 flex items-center justify-between"
    >
      <div className="flex items-center gap-3">
        <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center', net.color, 'bg-opacity-20')}>
          <span className="text-white">{net.icon}</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{net.label}</span>
            <span className="text-[10px] text-emerald-500 px-1.5 py-0.5 rounded-full bg-emerald-500/10">ENCRYPTED</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="w-24 h-1 rounded-full bg-white/10 overflow-hidden">
              <motion.div
                className={clsx('h-full rounded-full', net.color)}
                initial={{ width: 0 }}
                animate={{ width: `${networkStrength}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <span className="text-xs text-gray-500">{Math.round(networkStrength)}%</span>
          </div>
        </div>
      </div>

      <div className="hidden sm:flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className={`w-2 h-2 rounded-full ${backendOk === null ? 'bg-gray-500' : backendOk ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          {backendOk === null ? '...' : backendOk ? 'Connected' : 'Offline'}
        </div>
      </div>
    </motion.div>
  )
}
