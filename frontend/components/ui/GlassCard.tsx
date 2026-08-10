'use client'

import { motion } from 'framer-motion'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

interface GlassCardProps {
  children: ReactNode
  className?: string
  variant?: 'default' | 'primary' | 'neon'
  hover?: boolean
  onClick?: () => void
}

export function GlassCard({
  children,
  className,
  variant = 'default',
  hover = true,
  onClick,
}: GlassCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={clsx(
        'glass-card p-5',
        variant === 'primary' && 'border-neon-cyan/30 bg-neon-cyan/[0.03]',
        variant === 'neon' && 'border-neon-magenta/30 bg-neon-magenta/[0.03]',
        hover && 'cursor-pointer',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
      whileHover={hover ? { scale: 1.01, y: -2 } : undefined}
      whileTap={onClick ? { scale: 0.99 } : undefined}
    >
      {children}
    </motion.div>
  )
}
