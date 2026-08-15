'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Shield, Radio, Bell, Key, Download, QrCode, Share2, Info } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { ShareIdentityModal } from './ShareIdentityModal'
import { useStore } from '@/lib/store'
import { exportIdentityBackup } from '@/lib/e2e'
import { restoreFromBackup } from '@/lib/backup'
import type { NetworkType } from '@/lib/types'

export function SettingsPage() {
  const { settings, updateSettings, user } = useStore()
  const [showShare, setShowShare] = useState(false)

  const [backupPass, setBackupPass] = useState('')
  const [restorePass, setRestorePass] = useState('')
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [bkStatus, setBkStatus] = useState('')
  const [bkError, setBkError] = useState('')

  const handleExport = async () => {
    setBkError(''); setBkStatus('')
    try {
      const json = await exportIdentityBackup(backupPass)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cryptmessenger-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setBkStatus('Sauvegarde créée. Conservez-la en lieu sûr — elle est chiffrée avec votre phrase secrète.')
    } catch (e: any) {
      setBkError(e?.message || 'Échec de l\'export')
    }
  }

  const handleRestore = async () => {
    setBkError(''); setBkStatus('')
    if (!restoreFile) { setBkError('Choisissez d\'abord un fichier de sauvegarde'); return }
    try {
      const text = await restoreFile.text()
      const res = await restoreFromBackup(text, restorePass)
      setBkStatus(res.offline
        ? 'Restauré localement. Serveur inaccessible — vous pouvez lire l\'historique, mais les autres ne pourront pas vous joindre tant qu\'il ne revient pas.'
        : 'Identité et historique restaurés.')
    } catch (e: any) {
      setBkError(e?.message || 'Échec de la restauration')
    }
  }

  const networkOptions: { value: NetworkType; label: string }[] = [
    { value: 'hybrid', label: 'Hybride (Auto)' },
    { value: 'internet', label: 'Internet' },
    { value: 'lora', label: 'LoRaWAN' },
    { value: 'mesh', label: 'Maillage' },
    { value: 'satellite', label: 'Satellite' },
    { value: 'wifi', label: 'WiFi maillage' },
  ]

  return (
    <div className="p-4 space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
      <ShareIdentityModal open={showShare} onClose={() => setShowShare(false)} />

      <GlassCard hover={false} variant="neon">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-400/20 flex items-center justify-center">
            <Shield size={20} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[#f5e6d3]">Mon identité</h3>
            <p className="text-xs text-gray-400">Clé RSA-4096 • {user?.publicKeyFingerprint || ''}</p>
          </div>
        </div>
        <div className="glass-panel p-3 mb-3">
          <p className="text-[10px] text-gray-500 mb-1">Empreinte publique</p>
          <p className="text-sm font-mono text-amber-400 break-all">{user?.publicKeyFingerprint || '—'}</p>
        </div>
        <div className="flex gap-2">
          <GlassButton variant="primary" size="sm" onClick={() => setShowShare(true)} className="flex-1" icon={<QrCode size={14} />}>
            Partager mon identité
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
          <div><h3 className="text-sm font-medium text-[#f5e6d3]">Réseau</h3><p className="text-xs text-gray-400">Préférences</p></div>
        </div>
        <div className="space-y-3">
          <label className="text-sm text-gray-300 block mb-2">Réseau préféré</label>
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
          <Toggle label="Basculement auto du réseau" value={settings.autoSwitchNetwork} onChange={(v) => updateSettings({ autoSwitchNetwork: v })} />
          <Toggle label="Mode hors-ligne" value={settings.offlineMode} onChange={(v) => updateSettings({ offlineMode: v })} />
          <Toggle
            label="Light theme"
            value={settings.theme === 'light'}
            onChange={(v) => updateSettings({ theme: v ? 'light' : 'dark' })}
          />
        </div>
      </GlassCard>

      <GlassCard hover={false}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-orange-600/20 flex items-center justify-center"><Key size={20} className="text-orange-500" /></div>
          <div><h3 className="text-sm font-medium text-[#f5e6d3]">Chiffrement</h3><p className="text-xs text-gray-400">Sécurité</p></div>
        </div>
        <Toggle label="Chiffrement E2E" value={settings.encryptionEnabled} onChange={(v) => updateSettings({ encryptionEnabled: v })} />
        <Toggle label="Notifications" value={settings.notificationsEnabled} onChange={(v) => updateSettings({ notificationsEnabled: v })} />
        <Toggle
          label="Indicateurs de saisie"
          value={settings.typingEnabled}
          onChange={(v) => updateSettings({ typingEnabled: v })}
        />
        <div className="pt-3 space-y-2">
          <p className="text-sm text-gray-300">Affichage temporaire des messages</p>
          <p className="text-[10px] text-gray-500">Les messages déchiffrés se verrouillent automatiquement après :</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {[
            { value: 0, label: 'Manuel' },
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

          <div className="pt-3 space-y-2">
            <p className="text-sm text-gray-300">Messages éphémères</p>
            <p className="text-[10px] text-gray-500">Les messages sont supprimés définitivement après :</p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {[
                { value: 0, label: 'Désactivé' },
                { value: 10000, label: '10s' },
                { value: 60000, label: '1m' },
                { value: 600000, label: '10m' },
                { value: 3600000, label: '1h' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateSettings({ disappearingTTL: opt.value })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    settings.disappearingTTL === opt.value
                      ? 'bg-amber-400/20 text-amber-400 border border-amber-400/30'
                      : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </GlassCard>

      <GlassCard hover={false}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center"><Download size={20} className="text-emerald-400" /></div>
          <div><h3 className="text-sm font-medium text-[#f5e6d3]">Sauvegarde et restauration</h3><p className="text-xs text-gray-400">Récupération d'identité chiffrée</p></div>
        </div>

        <p className="text-[10px] text-gray-500 mb-2">Exportez une sauvegarde chiffrée (protégée par phrase secrète). Conservez-la en lieu sûr — elle permet de récupérer votre identité et votre historique sur un nouvel appareil.</p>
        <div className="flex gap-2 mb-2">
          <input type="password" placeholder="Phrase secrète de sauvegarde (min 8 caractères)" value={backupPass} onChange={(e) => setBackupPass(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-200 outline-none focus:border-amber-400/40" />
          <GlassButton variant="primary" size="sm" onClick={handleExport}>Exporter</GlassButton>
        </div>

        <div className="border-t border-white/5 my-3" />

        <p className="text-[10px] text-gray-500 mb-2">Restauration depuis un fichier de sauvegarde. La clé privée est déchiffrée uniquement en mémoire et jamais stockée en clair.</p>
        <div className="flex flex-col gap-2">
          <input type="file" accept="application/json,.json" onChange={(e) => setRestoreFile(e.target.files?.[0] || null)} className="text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-amber-400/20 file:text-amber-400 file:text-xs" />
          <div className="flex gap-2">
            <input type="password" placeholder="Phrase secrète de sauvegarde" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-200 outline-none focus:border-amber-400/40" />
            <GlassButton variant="ghost" size="sm" onClick={handleRestore}>Restaurer</GlassButton>
          </div>
        </div>

        {bkStatus && <p className="text-[11px] text-emerald-400 mt-3">{bkStatus}</p>}
        {bkError && <p className="text-[11px] text-rose-400 mt-3">{bkError}</p>}
      </GlassCard>

      <GlassCard hover={false} variant="neon">
        <div className="flex items-center gap-3">
          <Info size={16} className="text-amber-400" />
          <div>
            <p className="text-xs text-gray-300"><strong>CRYPTMessenger v0.1.0</strong> — RSA-4096 + AES-256-GCM</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Clé privée stockée uniquement en local</p>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3 gap-3 border-b border-white/5 last:border-b-0">
      <span className="text-sm text-gray-300 shrink min-w-0">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`shrink-0 w-11 h-6 rounded-full transition-all duration-300 ${value ? 'bg-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.4)]' : 'bg-white/10'}`}>
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="block w-5 h-5 bg-white rounded-full shadow-md"
          style={{ x: value ? 22 : 2 }}
        />
      </button>
    </div>
  )
}
