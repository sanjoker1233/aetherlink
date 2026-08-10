'use client'

import { clsx } from 'clsx'

interface StatusIndicatorProps {
  status: 'online' | 'offline' | 'mesh'
  className?: string
}

export function StatusIndicator({ status, className }: StatusIndicatorProps) {
  return (
    <span
      className={clsx(
        'status-indicator',
        status,
        className
      )}
    />
  )
}
