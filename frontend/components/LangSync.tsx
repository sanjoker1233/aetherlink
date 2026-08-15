'use client'

import { useEffect } from 'react'
import { useStore } from '@/lib/store'

// Keeps <html lang> in sync with the selected UI locale so screen readers and
// browser translation hints use the right language. Default is 'fr'.
export function LangSync() {
  const locale = useStore((s) => s.settings.locale)
  useEffect(() => {
    document.documentElement.lang = locale || 'fr'
  }, [locale])
  return null
}
