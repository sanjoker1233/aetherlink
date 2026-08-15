'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { wsManager } from '@/lib/ws-client'
import { WifiOff } from 'lucide-react'

export function ConnectionBanner() {
  const { wsConnected } = useStore()
  const t = useT()
  const [queued, setQueued] = useState(0)

  useEffect(() => {
    if (wsConnected) {
      setQueued(0)
      return
    }
    const tick = () => setQueued(wsManager.getQueuedCount())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [wsConnected])

  if (wsConnected) return null

  return (
    <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-amber-500/15 text-amber-200 text-xs border-b border-amber-400/20">
      <WifiOff size={13} className="shrink-0" />
      <span>{t('common.reconnecting')}{queued > 0 ? ` (${queued})` : ''}</span>
    </div>
  )
}
