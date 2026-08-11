'use client'

import { useEffect } from 'react'
import { useStore } from '@/lib/store'

export function StoreHydrator() {
  const hydrate = useStore((s) => s.hydrate)
  const hydrated = useStore((s) => s.hydrated)
  const theme = useStore((s) => s.settings.theme)

  useEffect(() => {
    void hydrate()
  }, [])

  // Apply the persisted theme once hydrated (avoids SSR/client mismatch).
  useEffect(() => {
    if (!hydrated) return
    document.documentElement.classList.toggle('dark', theme !== 'light')
  }, [hydrated, theme])

  return null
}
