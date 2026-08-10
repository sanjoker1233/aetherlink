'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Server, Wifi, Users, MessageSquare, Activity, Zap, RefreshCw, WifiOff } from 'lucide-react'
import { GlassCard } from '@/components/ui'
import { GlassButton } from '@/components/ui/GlassButton'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'

export function NetworkDashboard() {
  const { contacts, conversations, user } = useStore()
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [uptime, setUptime] = useState<string>('')

  const check = () => {
    api.health()
      .then((h) => {
        setBackendOk(true)
        setUptime(h.version || '')
      })
      .catch(() => setBackendOk(false))
  }

  useEffect(() => {
    check()
    const iv = setInterval(check, 10000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const iv = setInterval(() => {
      setWsConnected(document.visibilityState === 'visible')
    }, 3000)
    return () => clearInterval(iv)
  }, [])

  const messageCount = Object.values(useStore.getState().messages).reduce((a, m) => a + m.length, 0)

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <GlassCard variant="primary">
          <div className="flex items-center gap-3">
            <Server size={20} className={backendOk === null ? 'text-gray-500' : backendOk ? 'text-emerald-500' : 'text-rose-500'} />
            <div>
              <p className="text-lg font-bold text-[#f5e6d3]">{backendOk === null ? '...' : backendOk ? 'Connected' : 'Offline'}</p>
              <p className="text-xs text-gray-400">Server</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard variant="neon">
          <div className="flex items-center gap-3">
            <Users size={20} className="text-amber-400" />
            <div>
              <p className="text-2xl font-bold text-[#f5e6d3]">{contacts.length}</p>
              <p className="text-xs text-gray-400">Contacts</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard>
          <div className="flex items-center gap-3">
            <MessageSquare size={20} className="text-amber-600" />
            <div>
              <p className="text-2xl font-bold text-[#f5e6d3]">{conversations.length}</p>
              <p className="text-xs text-gray-400">Conversations</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard>
          <div className="flex items-center gap-3">
            <Activity size={20} className="text-orange-500" />
            <div>
              <p className="text-2xl font-bold text-[#f5e6d3]">{messageCount}</p>
              <p className="text-xs text-gray-400">Total messages</p>
            </div>
          </div>
        </GlassCard>
      </div>

      <GlassCard>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium flex items-center gap-2 text-[#f5e6d3]">
            <Wifi size={16} className="text-amber-400" /> Connection status
          </h3>
          <GlassButton variant="ghost" size="sm" onClick={check} icon={<RefreshCw size={12} />}>
            Tester
          </GlassButton>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-white/5">
            <span className="text-sm text-gray-300">Backend API</span>
            <span className={`flex items-center gap-1.5 text-xs font-medium ${
              backendOk === null ? 'text-gray-500' : backendOk ? 'text-emerald-500' : 'text-rose-500'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                backendOk === null ? 'bg-gray-500' : backendOk ? 'bg-emerald-500' : 'bg-rose-500'
              }`} />
              {backendOk === null ? 'Checking...' : backendOk ? 'Connected (:9090)' : 'Unreachable'}
            </span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-white/5">
            <span className="text-sm text-gray-300">WebSocket</span>
            <span className={`flex items-center gap-1.5 text-xs font-medium ${
              user?.id ? 'text-emerald-500' : 'text-gray-500'
            }`}>
              <span className={`w-2 h-2 rounded-full ${user?.id ? 'bg-emerald-500' : 'bg-gray-500'}`} />
              {user?.id ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-300">Identity</span>
            <span className="text-xs text-gray-400 font-mono">
              {user?.displayName || '—'} • {user?.publicKeyFingerprint || '—'}
            </span>
          </div>
        </div>
      </GlassCard>

      <GlassCard variant="neon">
        <div className="flex items-center gap-3">
          <Zap size={20} className="text-amber-400" />
          <div>
            <p className="text-sm font-medium text-[#f5e6d3]">Encryption de bout en bout</p>
            <p className="text-xs text-gray-400">RSA-4096 (exchange) + AES-256-GCM (messages)</p>
            <p className="text-[10px] text-gray-500 mt-1">Private key stored locally only • Not shared</p>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
