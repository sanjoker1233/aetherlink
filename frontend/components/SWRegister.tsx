'use client'

import { useEffect } from 'react'

export function SWRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[PWA] New version available. Reload.')
                }
              })
            }
          })
        })
        .catch((err) => console.error('[PWA] Service worker registration failed:', err))
    }
  }, [])

  return null
}
