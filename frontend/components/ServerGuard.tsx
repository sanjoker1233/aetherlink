'use client'

import { useEffect, useState } from 'react'
import { ServerOff, RefreshCw, Loader2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'

/**
 * Server-aware gating.
 *
 * aetherlink is server-dependent, but conversations/messages are cached in
 * localStorage and re-hydrated on load (see lib/store.ts `hydrate`), so the
 * user must still be able to READ their cached conversations when the backend
 * is unreachable. Behaviour:
 *
 *   serverAvailable === null  -> status unknown (initial load / in-flight):
 *                                 show a "connecting" splash so we never flash
 *                                 a half-rendered app.
 *   serverAvailable === false -> backend confirmed down: still RENDER the app
 *                                 (cached conversations stay readable in
 *                                 offline mode) but surface a persistent banner
 *                                 so the user knows they are offline and
 *                                 server-dependent actions won't work.
 *   serverAvailable === true  -> backend reachable: render the app normally.
 */
export function ServerGuard({ children }: { children: React.ReactNode }) {
  const serverAvailable = useStore((s) => s.serverAvailable)
  const setServerAvailable = useStore((s) => s.setServerAvailable)
  const [checking, setChecking] = useState(false)

  const check = () => {
    setChecking(true)
    api.health()
      .then(() => setServerAvailable(true))
      .catch(() => setServerAvailable(false))
      .finally(() => setChecking(false))
  }

  useEffect(() => {
    check()
    const iv = setInterval(check, 10000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Status unknown (initial load / in-flight check): connecting splash.
  if (serverAvailable === null) {
    return (
      <div
        role="alertdialog"
        aria-busy="true"
        aria-live="assertive"
        className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 px-6 text-center bg-[#120c0a] text-rose-100"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-950/60 border border-rose-500/30">
          <Loader2 size={30} className="animate-spin text-rose-300" />
        </div>
        <h1 className="text-lg font-semibold">Connexion au serveur…</h1>
        <p className="max-w-xs text-sm text-rose-200/70">Vérification de la disponibilité du serveur.</p>
      </div>
    )
  }

  // Server confirmed down: render the app (cached conversations are readable)
  // with a persistent offline banner.
  if (serverAvailable === false) {
    return (
      <>
        {children}
        <OfflineBanner checking={checking} onRetry={check} />
      </>
    )
  }

  // Server reachable: render the app normally.
  return <>{children}</>
}

function OfflineBanner({ checking, onRetry }: { checking: boolean; onRetry: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="server-offline-banner"
      className="fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-3 px-4 py-2 bg-rose-950/90 border-b border-rose-500/30 text-xs text-rose-100 backdrop-blur"
    >
      <ServerOff size={14} className="text-rose-400 shrink-0" />
      <span className="min-w-0">
        Serveur indisponible — mode hors-ligne, lecture seule. Vos conversations en cache restent consultables.
      </span>
      <button
        onClick={onRetry}
        disabled={checking}
        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50"
      >
        <RefreshCw size={12} className={checking ? 'animate-spin' : ''} /> Réessayer
      </button>
    </div>
  )
}
