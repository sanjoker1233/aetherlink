'use client'

import { useStore } from '@/lib/store'

/**
 * Reconnection banner for the WebSocket layer. The server-down case is already
 * handled by <ServerGuard> (rose banner). This component covers the gap where
 * the server is reachable but the live socket dropped — e.g. a momentary
 * network blip or the Android app being backgrounded. Outgoing messages are
 * queued locally in WSManager and flushed automatically on reconnect, so we
 * only need to tell the user what is happening.
 */
export function ConnectionBanner() {
  const wsConnected = useStore((s) => s.wsConnected)
  const serverAvailable = useStore((s) => s.serverAvailable)

  // Server down -> ServerGuard shows the rose banner. Only show here when the
  // socket itself is the problem.
  if (wsConnected || serverAvailable === false) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[90] flex items-center justify-center gap-2 px-4 py-2 bg-amber-500/15 border-b border-amber-400/30 text-xs text-amber-200 backdrop-blur"
    >
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
      <span className="min-w-0">
        Reconnexion… vos messages seront envoyés automatiquement.
      </span>
    </div>
  )
}
