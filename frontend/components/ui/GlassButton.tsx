'use client'

import { motion } from 'framer-motion'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

interface GlassButtonProps {
  children: ReactNode
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit'
  icon?: ReactNode
}

export function GlassButton({
  children,
  variant = 'default',
  size = 'md',
  onClick,
  className,
  disabled,
  type = 'button',
  icon,
}: GlassButtonProps) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'relative overflow-hidden rounded-xl font-semibold text-white transition-all duration-300 inline-flex items-center justify-center gap-2',
        variant === 'default' && 'glass-button',
        variant === 'primary' && 'glass-button-primary',
        variant === 'ghost' && 'bg-transparent border border-white/10 hover:bg-white/10 hover:border-white/20',
        variant === 'danger' && 'bg-neon-rose/20 border border-neon-rose/30 hover:bg-neon-rose/30 hover:shadow-neon-magenta',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-5 py-2.5 text-sm',
        size === 'lg' && 'px-8 py-3.5 text-base',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </motion.button>
  )
}
