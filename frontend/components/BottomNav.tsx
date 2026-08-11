'use client'

import { MessageSquare, Users, Radio, Settings, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { useStore } from '@/lib/store'
import { wsManager } from '@/lib/ws-client'
import type { TabType } from '@/lib/types'

const items: { id: TabType; label: string; icon: ReactNode }[] = [
  { id: 'chats', label: 'Messages', icon: <MessageSquare size={22} /> },
  { id: 'contacts', label: 'Contacts', icon: <Users size={22} /> },
  { id: 'network', label: 'Réseau', icon: <Radio size={22} /> },
  { id: 'settings', label: 'Réglages', icon: <Settings size={22} /> },
]

export function BottomNav() {
  const { activeTab, setActiveTab, activeConversationId, isAuthenticated, logout } = useStore()

  // Only relevant once logged in; on phones the sidebar is hidden.
  if (!isAuthenticated) return null
  // Hide the bar while reading a conversation so the thread gets full height.
  if (activeTab === 'chats' && activeConversationId) return null

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 glass border-t border-white/10 flex items-stretch"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Navigation principale"
    >
      {items.map((item) => {
        const active = activeTab === item.id
        return (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={clsx(
              'flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] transition-colors',
              active ? 'text-amber-400' : 'text-[#a3866a] hover:text-[#f5e6d3]'
            )}
            aria-current={active ? 'page' : undefined}
          >
            {item.icon}
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        )
      })}
      <button
        onClick={() => { wsManager.disconnect(); logout() }}
        className="px-3 flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[#a3866a] hover:text-rose-400 transition-colors"
        aria-label="Se déconnecter"
        title="Se déconnecter"
      >
        <LogOut size={20} />
        <span className="text-[10px] font-medium">Quit</span>
      </button>
    </nav>
  )
}
