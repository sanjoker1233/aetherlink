'use client'

import { clsx } from 'clsx'

interface AvatarProps {
  name: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  status?: 'online' | 'offline' | 'mesh'
  src?: string
}

export function Avatar({ name, size = 'md', status, src }: AvatarProps) {
  const initials = (name || '')
    .split(/[\s-]+/)
    .map((n) => n[0] || '')
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
    xl: 'w-16 h-16 text-lg',
  }

  const statusSizes = {
    sm: 'w-2.5 h-2.5 right-0 bottom-0',
    md: 'w-3 h-3 right-0 bottom-0',
    lg: 'w-3.5 h-3.5 right-0.5 bottom-0.5',
    xl: 'w-4 h-4 right-0.5 bottom-0.5',
  }

  if (src) {
    return (
      <div className="relative shrink-0">
        <img
          src={src}
          alt={name || 'Avatar'}
          className={clsx('rounded-full object-cover', sizeClasses[size])}
        />
        {status && (
          <span className={clsx('absolute status-indicator', status, statusSizes[size])} />
        )}
      </div>
    )
  }

  return (
    <div className="relative shrink-0">
      <div
        className={clsx(
          'rounded-full flex items-center justify-center font-semibold',
          'bg-gradient-to-br from-neon-cyan/20 via-neon-violet/20 to-neon-magenta/20',
          'border border-white/10',
          sizeClasses[size]
        )}
      >
        {initials}
      </div>
      {status && (
        <span className={clsx('absolute status-indicator', status, statusSizes[size])} />
      )}
    </div>
  )
}
