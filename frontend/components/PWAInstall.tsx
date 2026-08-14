'use client'

import { useEffect, useState, useCallback } from 'react'

// Custom "Add to Home Screen" / install prompt.
// The browser only fires `beforeinstallprompt` when the PWA meets
// installability criteria AND the user hasn't already dismissed/installed it.
// We capture the event and let the user trigger prompt() from a button
// (browsers block programmatic prompt() without a prior user gesture).

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'pwa-install-dismissed'

export function PWAInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [show, setShow] = useState(false)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    // Already running as an installed PWA?
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    if (standalone) {
      setInstalled(true)
      return
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      if (localStorage.getItem(DISMISS_KEY) !== '1') setShow(true)
    }
    const onInstalled = () => {
      setInstalled(true)
      setShow(false)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (!deferred) return
    await deferred.prompt()
    const choice = await deferred.userChoice
    if (choice?.outcome === 'accepted') {
      localStorage.setItem(DISMISS_KEY, '1')
    }
    setDeferred(null)
    setShow(false)
  }, [deferred])

  const close = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, '1')
    setShow(false)
  }, [])

  if (installed || !show || !deferred) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[60] p-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)] md:bottom-4 md:left-auto md:right-4 md:max-w-sm">
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#1a1411]/95 px-4 py-3 shadow-2xl backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">Installer CRYPTMessenger</p>
          <p className="mt-0.5 text-xs text-white/60">
            Accès rapide et messages hors-ligne depuis l&apos;écran d&apos;accueil.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={close}
            aria-label="Fermer"
            className="min-h-[32px] rounded-lg px-3 py-2 text-sm text-white/60 hover:text-white"
          >
            Plus tard
          </button>
          <button
            onClick={install}
            className="min-h-[32px] rounded-lg bg-[#16d98e] px-4 py-2 text-sm font-semibold text-black"
          >
            Installer
          </button>
        </div>
      </div>
    </div>
  )
}
