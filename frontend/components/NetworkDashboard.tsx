'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Server, Wifi, Users, MessageSquare, Activity, Zap, RefreshCw, WifiOff, Radio, Satellite, Network } from 'lucide-react'
import { GlassCard } from '@/components/ui'
import { GlassButton } from '@/components/ui/GlassButton'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'

export function NetworkDashboard() {
  const { contacts, conversations, user, wsConnected, serverAvailable } = useStore()
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [net, setNet] = useState<any>(null)
  const [lora, setLora] = useState<any>(null)
  const [meshtastic, setMeshtastic] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const check = () => {
    api.health()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false))
  }

  const refreshMesh = async () => {
    setLoading(true)
    try {
      const [n, l, m] = await Promise.allSettled([
        api.getNetworkStatus(),
        api.getLoraStatus(),
        api.getMeshtasticStatus(),
      ])
      if (n.status === 'fulfilled') setNet(n.value)
      if (l.status === 'fulfilled') setLora(l.value)
      if (m.status === 'fulfilled') setMeshtastic(m.value)
    } catch {
      // best-effort; leave previous values in place
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    check()
    const iv = setInterval(check, 10000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    // Mesh/LoRa/Meshtastic status is auth-gated, so only fetch once we have a
    // live WebSocket (which implies a valid token).
    if (wsConnected) refreshMesh()
    const iv = setInterval(() => { if (wsConnected) refreshMesh() }, 15000)
    return () => clearInterval(iv)
  }, [wsConnected])

  const messageCount = Object.values(useStore.getState().messages).reduce((a, m) => a + m.length, 0)

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
          <GlassButton variant="ghost" size="sm" onClick={() => { check(); refreshMesh() }} icon={<RefreshCw size={12} className={loading ? 'animate-spin' : ''} />}>
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
              wsConnected ? 'text-emerald-500' : 'text-rose-500'
            }`}>
              <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              {wsConnected ? 'Connected' : 'Disconnected'}
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
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-400/20 flex items-center justify-center">
            <Network size={20} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[#f5e6d3]">Mesh &amp; Bridges</h3>
            <p className="text-xs text-gray-400">Live status from the relay server</p>
          </div>
        </div>

        {!wsConnected ? (
          <p className="text-xs text-gray-500">Connect to the server to see mesh bridge status.</p>
        ) : (
          <div className="space-y-2">
            <BridgeRow
              icon={<Wifi size={16} className="text-neon-blue" />}
              name="Internet relay"
              enabled={net ? true : false}
              detail={net ? `Active network: ${net.activeType || 'internet'}` : '—'}
            />
            <BridgeRow
              icon={<Radio size={16} className="text-neon-green" />}
              name="LoRaWAN"
              enabled={!!lora?.enabled}
              detail={lora ? (lora.enabled ? `${lora.region || '—'} • ${lora.gateways ?? 0} gw • ${lora.devices ?? 0} dev` : 'Désactivé — non configuré') : '—'}
            />
            <BridgeRow
              icon={<Satellite size={16} className="text-neon-amber" />}
              name="Meshtastic"
              enabled={!!meshtastic?.enabled}
              detail={meshtastic ? (meshtastic.enabled ? `${meshtastic.channel || '—'} • ${meshtastic.nodes ?? 0} nodes` : 'Désactivé — non configuré') : '—'}
            />
          </div>
        )}
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

function BridgeRow({ icon, name, enabled, detail }: { icon: React.ReactNode; name: string; enabled: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
      <span className="shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-200">{name}</p>
        <p className="text-[10px] text-gray-500 truncate">{detail}</p>
      </div>
      <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
        enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-500/15 text-gray-400'
      }`}>
        {enabled ? 'Active' : 'Désactivé'}
      </span>
    </div>
  )
}
