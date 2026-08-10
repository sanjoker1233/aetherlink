'use client'

import { useEffect } from 'react'
import { useStore } from '@/lib/store'
import { wsManager } from '@/lib/ws-client'

export function WSInit() {
  const user = useStore((s) => s.user)

  useEffect(() => {
    if (user?.id) {
      wsManager.connect(user.id)
    } else {
      wsManager.disconnect()
    }
    return () => wsManager.disconnect()
  }, [user?.id])

  return null
}
