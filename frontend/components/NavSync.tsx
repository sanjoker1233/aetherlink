'use client'

import { useEffect, useRef } from 'react'
import { useStore } from '@/lib/store'

export function NavSync() {
  const activeTab = useStore((s) => s.activeTab)
  const activeConv = useStore((s) => s.activeConversationId)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const setActiveConversation = useStore((s) => s.setActiveConversation)
  const initial = useRef(true)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab') as 'chats' | 'contacts' | 'network' | 'settings' | null
    const conv = params.get('conv')
    if (tab && ['chats', 'contacts', 'network', 'settings'].includes(tab)) {
      setActiveTab(tab)
    }
    if (conv) setActiveConversation(conv)
    initial.current = false
  }, [])

  useEffect(() => {
    if (initial.current) return
    const url = new URL(window.location.href)
    if (activeTab !== 'chats') {
      url.searchParams.set('tab', activeTab)
    } else {
      url.searchParams.delete('tab')
    }
    if (activeConv) {
      url.searchParams.set('conv', activeConv)
    } else {
      url.searchParams.delete('conv')
    }
    window.history.replaceState(
      { tab: activeTab, conv: activeConv },
      '',
      url.pathname + url.search
    )
  }, [activeTab, activeConv])

  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search)
      const tab = params.get('tab') as 'chats' | 'contacts' | 'network' | 'settings' | null
      const conv = params.get('conv')
      if (tab && ['chats', 'contacts', 'network', 'settings'].includes(tab)) {
        setActiveTab(tab)
      } else {
        setActiveTab('chats')
      }
      setActiveConversation(conv || null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return null
}
