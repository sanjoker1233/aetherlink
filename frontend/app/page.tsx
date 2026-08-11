'use client'

import { useStore } from '@/lib/store'
import { ChatList } from '@/components/ChatList'
import { ChatArea } from '@/components/ChatArea'
import { ContactsList } from '@/components/ContactsList'
import { NetworkDashboard } from '@/components/NetworkDashboard'
import { SettingsPage } from '@/components/SettingsPage'
import { AuthPage } from '@/components/AuthPage'

export default function Home() {
  const { isAuthenticated, activeTab, activeConversationId, hydrated } = useStore()

  // Don't flash authenticated UI before localStorage/IndexedDB hydration.
  if (!hydrated) {
    return (
      <div className="flex items-center justify-center h-full p-8" aria-busy="true">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <AuthPage />
  }

  if (activeTab === 'chats') {
    return (
      <div className="flex h-full">
        <div className={`${activeConversationId ? 'hidden md:block' : 'block'} w-full md:w-[340px] lg:w-[380px] border-r border-white/5 overflow-y-auto`}>
          <div className="p-4 border-b border-white/5">
            <h2 className="text-lg font-semibold neon-text">Messages</h2>
          </div>
          <ChatList />
        </div>
        <div className={`${!activeConversationId ? 'hidden md:flex' : 'flex'} flex-1 flex-col min-w-0`}>
          <ChatArea />
        </div>
      </div>
    )
  }

  if (activeTab === 'contacts') {
    return (
      <div className="max-w-2xl md:max-w-3xl xl:max-w-5xl mx-auto w-full">
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
      <div className="max-w-2xl md:max-w-3xl xl:max-w-4xl mx-auto w-full">
        <div className="p-4 border-b border-white/5">
          <h2 className="text-lg font-semibold neon-text">Settings</h2>
        </div>
        <SettingsPage />
      </div>
    )
  }

  return null
}
