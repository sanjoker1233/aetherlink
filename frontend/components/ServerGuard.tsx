'use client'

import { useEffect, useState } from 'react'
import { ServerOff, RefreshCw, Loader2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'

/**
 * Server-gated access.
 *
 * aetherlink is a server-dependent messenger: identity registration, contact
 * requests, message relay and the websocket all live on the backend. When the
 * backend is unreachable we must NOT render a broken half-loaded UI — instead we
 * block the whole app with a full-screen "server unavailable" screen and a
 * Retry control. The user only reaches the app once /health confirms the
 * server is reachable.
 *
 * States:
 *   serverAvailable === null  -> status unknown (initial load / in-flight): show
 *                                 a "connecting" splash so we never flash content.
 *   serverAvailable === false -> backend confirmed down: block the app entirely.
 *   serverAvailable === true  -> backend reachable: render the app.
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

  if (serverAvailable === null) {
    return (
      <GateScreen
        icon="loading"
        title="Connexion au serveur…"
        hint="Vérification de la disponibilité du serveur."
        checking={checking}
      />
    )
  }

  if (serverAvailable === false) {
    return (
      <GateScreen
        icon="off"
        title="Serveur indisponible"
        hint="L'application nécessite le serveur pour fonctionner. Vérifiez votre connexion, puis réessayez."
        checking={checking}
        onRetry={check}
      />
    )
  }

  return <>{children}</>
}

function GateScreen({
  icon,
  title,
  hint,
  checking,
  onRetry,
}: {
  icon: 'loading' | 'off'
  title: string
  hint: string
  checking: boolean
  onRetry?: () => void
}) {
  return (
    <div
      role="alertdialog"
      aria-busy={icon === 'loading'}
      aria-live="assertive"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 px-6 text-center bg-[#120c0a] text-rose-100"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-950/60 border border-rose-500/30">
        {icon === 'loading' ? (
          <Loader2 size={30} className="animate-spin text-rose-300" />
        ) : (
          <ServerOff size={30} className="text-rose-400" />
        )}
      </div>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="max-w-xs text-sm text-rose-200/70">{hint}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={checking}
          className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-50 text-sm"
        >
          <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
          {checking ? 'Vérification…' : 'Réessayer'}
        </button>
      )}
    </div>
  )
}
