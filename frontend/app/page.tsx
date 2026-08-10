'use client'

import { useStore } from '@/lib/store'
import { ChatList } from '@/components/ChatList'
import { ChatArea } from '@/components/ChatArea'
import { ContactsList } from '@/components/ContactsList'
import { NetworkDashboard } from '@/components/NetworkDashboard'
import { SettingsPage } from '@/components/SettingsPage'
import { AuthPage } from '@/components/AuthPage'

export default function Home() {
  const { isAuthenticated, activeTab, activeConversationId } = useStore()

  if (!isAuthenticated) {
    return <AuthPage />
  }

  if (activeTab === 'chats') {
    return (
      <div className="flex h-full">
        <div className={`${activeConversationId ? 'hidden lg:block' : 'block'} w-full lg:w-[360px] border-r border-white/5 overflow-y-auto`}>
          <div className="p-4 border-b border-white/5">
            <h2 className="text-lg font-semibold neon-text">Messages</h2>
          </div>
          <ChatList />
        </div>
        <div className={`${!activeConversationId ? 'hidden lg:flex' : 'flex'} flex-1 flex-col`}>
          <ChatArea />
        </div>
      </div>
    )
  }

  if (activeTab === 'contacts') {
    return (
      <div className="max-w-2xl mx-auto w-full">
        <div className="p-4 border-b border-white/5">
          <h2 className="text-lg font-semibold neon-text">Contacts</h2>
        </div>
        <ContactsList />
      </div>
    )
  }

  if (activeTab === 'network') {
    return (
      <div className="w-full">
        <div className="p-4 border-b border-white/5">
          <h2 className="text-lg font-semibold neon-text">Mesh Network</h2>
        </div>
        <NetworkDashboard />
      </div>
    )
  }

  if (activeTab === 'settings') {
    return (
      <div className="max-w-2xl mx-auto w-full">
        <div className="p-4 border-b border-white/5">
          <h2 className="text-lg font-semibold neon-text">Settings</h2>
        </div>
        <SettingsPage />
      </div>
    )
  }

  return null
}
