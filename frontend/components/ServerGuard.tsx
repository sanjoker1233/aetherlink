'use client'

import { useEffect, useState } from 'react'
import { ServerOff, RefreshCw, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'

/**
 * Offline-first: the app is ALWAYS rendered (local key generation, reading
 * cached conversations, etc. must work without a server). When /health fails
 * we surface a dismissible banner instead of blocking the whole UI.
 */
export function ServerGuard({ children }: { children: React.ReactNode }) {
  const serverAvailable = useStore((s) => s.serverAvailable)
  const setServerAvailable = useStore((s) => s.setServerAvailable)
  const [dismissed, setDismissed] = useState(false)

  const check = () => {
    api.health()
      .then(() => setServerAvailable(true))
      .catch(() => setServerAvailable(false))
  }

  useEffect(() => {
    check()
    const iv = setInterval(check, 10000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const offline = serverAvailable === false

  return (
    <>
      {offline && !dismissed && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-3 px-4 py-2 bg-rose-950/90 border-b border-rose-500/30 text-xs text-rose-100 backdrop-blur"
        >
          <ServerOff size={14} className="text-rose-400 shrink-0" />
          <span className="min-w-0">
            Server unreachable — working offline. Messages will send when the server is back.
          </span>
          <button
            onClick={check}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20"
          >
            <RefreshCw size={12} /> Retry
          </button>
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss offline notice"
            className="shrink-0 p-1 rounded-lg hover:bg-white/10"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {children}
    </>
  )
}
