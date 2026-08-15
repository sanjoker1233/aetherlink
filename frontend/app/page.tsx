'use client'

import dynamic from 'next/dynamic'
import { useStore } from '@/lib/store'
import { ChatList } from '@/components/ChatList'
import { ChatArea } from '@/components/ChatArea'
import { AuthPage } from '@/components/AuthPage'

// Tab-gated views are not needed on first paint — lazy-load them so the
// initial route JS (and First Load JS) stays small on mobile/Android.
const Loading = () => <div className="p-4 text-sm text-gray-500">Chargement…</div>
const ContactsList = dynamic(() => import('@/components/ContactsList').then((m) => m.ContactsList), { ssr: false, loading: () => <Loading /> })
const NetworkDashboard = dynamic(() => import('@/components/NetworkDashboard').then((m) => m.NetworkDashboard), { ssr: false, loading: () => <Loading /> })
const SettingsPage = dynamic(() => import('@/components/SettingsPage').then((m) => m.SettingsPage), { ssr: false, loading: () => <Loading /> })

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
