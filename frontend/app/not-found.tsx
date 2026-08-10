'use client'

import { Lock, Home } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useRouter } from 'next/navigation'

export default function NotFound() {
  const router = useRouter()
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <GlassCard variant="neon" hover={false} className="p-8 max-w-sm text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-neon-cyan via-neon-violet to-neon-magenta flex items-center justify-center mx-auto mb-4">
          <Lock size={28} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold neon-text mb-2">404</h1>
        <p className="text-gray-400 text-sm mb-6">Page not found</p>
        <GlassButton variant="primary" onClick={() => router.push('/')} icon={<Home size={14} />}>
          Back to home
        </GlassButton>
      </GlassCard>
    </div>
  )
}
