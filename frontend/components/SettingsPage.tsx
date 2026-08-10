'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Shield, Radio, Bell, Key, Download, QrCode, Share2, Info } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { ShareIdentityModal } from './ShareIdentityModal'
import { useStore } from '@/lib/store'
import type { NetworkType } from '@/lib/types'

export function SettingsPage() {
  const { settings, updateSettings, user } = useStore()
  const [showShare, setShowShare] = useState(false)

  const networkOptions: { value: NetworkType; label: string }[] = [
    { value: 'hybrid', label: 'Hybrid (Auto)' },
    { value: 'internet', label: 'Internet' },
    { value: 'lora', label: 'LoRaWAN' },
    { value: 'mesh', label: 'Mesh' },
    { value: 'satellite', label: 'Satellite' },
    { value: 'wifi', label: 'WiFi Mesh' },
  ]

  return (
    <div className="p-4 space-y-4">
      <ShareIdentityModal open={showShare} onClose={() => setShowShare(false)} />

      <GlassCard hover={false} variant="neon">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-400/20 flex items-center justify-center">
            <Shield size={20} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[#f5e6d3]">My identity</h3>
            <p className="text-xs text-gray-400">RSA-4096 key • {user?.publicKeyFingerprint || ''}</p>
          </div>
        </div>
        <div className="glass-panel p-3 mb-3">
          <p className="text-[10px] text-gray-500 mb-1">Public fingerprint</p>
          <p className="text-sm font-mono text-amber-400 break-all">{user?.publicKeyFingerprint || '—'}</p>
        </div>
        <div className="flex gap-2">
          <GlassButton variant="primary" size="sm" onClick={() => setShowShare(true)} className="flex-1" icon={<QrCode size={14} />}>
            Share my identity
          </GlassButton>
          <GlassButton variant="ghost" size="sm" onClick={() => {
            const a = document.createElement('a')
            a.download = 'cryptmessenger-identity.txt'
            a.href = 'data:text/plain,' + encodeURIComponent(JSON.stringify({
              name: user?.displayName,
              publicKey: user?.publicKey,
              fingerprint: user?.publicKeyFingerprint,
            }, null, 2))
            a.click()
          }} icon={<Download size={14} />}>
            Exporter
          </GlassButton>
        </div>
      </GlassCard>

      <GlassCard hover={false}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-600/20 flex items-center justify-center"><Radio size={20} className="text-amber-600" /></div>
          <div><h3 className="text-sm font-medium text-[#f5e6d3]">Network</h3><p className="text-xs text-gray-400">Preferences</p></div>
        </div>
        <div className="space-y-3">
          <label className="text-sm text-gray-300 block mb-2">Preferred network</label>
          <div className="grid grid-cols-2 gap-2">
            {networkOptions.map((opt) => (
              <button key={opt.value}
                onClick={() => updateSettings({ preferredNetwork: opt.value })}
                className={`px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                  settings.preferredNetwork === opt.value
                    ? 'bg-amber-400/20 text-amber-400 border border-amber-400/30'
                    : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10'
                }`}>{opt.label}</button>
            ))}
          </div>
          <Toggle label="Auto network switch" value={settings.autoSwitchNetwork} onChange={(v) => updateSettings({ autoSwitchNetwork: v })} />
          <Toggle label="Offline mode" value={settings.offlineMode} onChange={(v) => updateSettings({ offlineMode: v })} />
        </div>
      </GlassCard>

      <GlassCard hover={false}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-orange-600/20 flex items-center justify-center"><Key size={20} className="text-orange-500" /></div>
          <div><h3 className="text-sm font-medium text-[#f5e6d3]">Encryption</h3><p className="text-xs text-gray-400">Security</p></div>
        </div>
        <Toggle label="Encryption E2E" value={settings.encryptionEnabled} onChange={(v) => updateSettings({ encryptionEnabled: v })} />
        <Toggle label="Notifications" value={settings.notificationsEnabled} onChange={(v) => updateSettings({ notificationsEnabled: v })} />
        <div className="pt-3 space-y-2">
          <p className="text-sm text-gray-300">Temporary message display</p>
          <p className="text-[10px] text-gray-500">Decrypted messages re-lock automatically after:</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {[
              { value: 0, label: 'Manual' },
              { value: 2000, label: '2s' },
              { value: 5000, label: '5s' },
              { value: 10000, label: '10s' },
              { value: 20000, label: '20s' },
              { value: 30000, label: '30s' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => updateSettings({ decryptDuration: opt.value })}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  settings.decryptDuration === opt.value
                    ? 'bg-amber-400/20 text-amber-400 border border-amber-400/30'
                    : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>

      <GlassCard hover={false} variant="neon">
        <div className="flex items-center gap-3">
          <Info size={16} className="text-amber-400" />
          <div>
            <p className="text-xs text-gray-300"><strong>CRYPTMessenger v0.1.0</strong> — RSA-4096 + AES-256-GCM</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Private key stored locally only</p>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-3 gap-3 cursor-pointer border-b border-white/5 last:border-b-0">
      <span className="text-sm text-gray-300 shrink min-w-0">{label}</span>
      <button onClick={() => onChange(!value)}
        className={`shrink-0 w-11 h-6 rounded-full transition-all duration-300 ${value ? 'bg-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.4)]' : 'bg-white/10'}`}>
        <motion.div
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="w-5 h-5 bg-white rounded-full shadow-md"
          style={{ x: value ? 22 : 2 }}
        />
      </button>
    </label>
  )
}
