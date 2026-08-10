import { Lock } from 'lucide-react'

export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-neon-cyan via-neon-violet to-neon-magenta flex items-center justify-center mx-auto mb-4 animate-pulse">
          <Lock size={28} className="text-white" />
        </div>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  )
}
