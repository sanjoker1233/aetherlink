'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Lock, MessageSquare, Search, UserPlus, UserCheck, X, Loader } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { GlassButton } from '@/components/ui/GlassButton'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { wsManager } from '@/lib/ws-client'
import type { ContactRequest } from '@/lib/types'
import { useState, useCallback, useRef, useEffect } from 'react'

export function ChatList() {
  const {
    conversations, activeConversationId, setActiveConversation,
    contactRequests, user, contacts, setSidebarOpen, pendingRequests,
  } = useStore()
  const closeSidebar = () => { if (window.innerWidth < 768) setSidebarOpen(false) }
  const [showSearch, setShowSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [sendingTo, setSendingTo] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Debounced search
  useEffect(() => {
    if (!query.trim() || !showSearch) {
      setResults([])
      return
    }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await api.searchUsers(query.trim())
        const ownId = user?.id || ''
        setResults(res.filter((u: any) => u.userId !== ownId))
      } catch { setResults([]) }
      setLoading(false)
    }, 300)
    return () => clearTimeout(t)
  }, [query, showSearch, user?.id])

  const handleSendRequest = useCallback((target: any) => {
    setSendingTo(target.userId)
    wsManager.sendContactRequest(target.userId)
    setTimeout(() => setSendingTo(null), 1000)
  }, [])

  const openConversation = useCallback((userId: string) => {
    const conv = conversations.find((c) => c.participants?.includes(userId))
    if (conv) { setActiveConversation(conv.id); closeSidebar() }
  }, [conversations, setActiveConversation])

  const handleAccept = useCallback((req: ContactRequest) => {
    wsManager.acceptContact(req)
  }, [])

  const isContact = useCallback((userId: string) => {
    return contacts.some((c) => c.userId === userId)
  }, [contacts])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-white/5">
        <GlassButton variant="primary" size="sm" className="w-full" onClick={() => { setShowSearch(!showSearch); setQuery('') }} icon={<Search size={14} />}>
          New conversation
        </GlassButton>

        <AnimatePresence>
          {showSearch && (
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }} className="mt-2"
            >
              <form className="flex gap-2 mb-2" role="search" onSubmit={(e) => e.preventDefault()}>
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    ref={searchRef}
                    autoFocus
                    value={query}
                    type="search"
                    aria-label="Search users by name or fingerprint"
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Name or fingerprint..."
                    className="glass-input w-full text-base pl-9 pr-8"
                  />
                  {query && (
                    <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                      <X size={14} className="text-gray-500" />
                    </button>
                  )}
                </div>
              </form>

              {loading && (
                <div className="flex items-center justify-center py-4">
                  <Loader size={18} className="animate-spin text-gray-500" />
                </div>
              )}

              {!loading && query && results.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-3">No user found</p>
              )}

              {results.length > 0 && (
                <div className="max-h-52 overflow-y-auto space-y-1">
                  {results.map((u) => (
                    <div
                      key={u.userId}
                      onClick={() => { if (isContact(u.userId)) openConversation(u.userId) }}
                      className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isContact(u.userId) ? 'cursor-pointer hover:bg-white/5' : 'hover:bg-white/5'}`}
                    >
                      <Avatar name={u.displayName || '?'} size="sm" status="online" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{u.displayName}</p>
                        <p className="text-[10px] text-gray-500 truncate font-mono">{u.fingerprint}</p>
                      </div>
                      {isContact(u.userId) ? (
                        <span className="text-[10px] text-green-400 flex items-center gap-1 shrink-0"><UserCheck size={12} /> Contact</span>
                      ) : pendingRequests.includes(u.userId) ? (
                        <span className="text-[10px] text-neon-amber flex items-center gap-1 shrink-0"><UserPlus size={12} /> Pending</span>
                      ) : (
                        <GlassButton
                          size="sm"
                          onClick={() => handleSendRequest(u)}
                          disabled={sendingTo === u.userId}
                          icon={<UserPlus size={12} />}
                          variant={sendingTo === u.userId ? 'primary' : 'ghost'}
                        >
                          Add
                        </GlassButton>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Incoming contact requests */}
      {contactRequests.length > 0 && (
        <div className="px-3 py-2 border-b border-amber-400/10 bg-amber-400/5">
          <p className="text-[10px] text-amber-400 font-medium uppercase tracking-wider mb-1.5">
            Contact requests ({contactRequests.length})
          </p>
          <div className="space-y-1">
            {contactRequests.map((req) => (
              <div key={req.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-white/5">
                <Avatar name={req.fromName} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{req.fromName}</p>
                  <p className="text-[9px] text-gray-500 font-mono truncate">{req.fromFingerprint}</p>
                </div>
                <GlassButton size="sm" onClick={() => handleAccept(req)} icon={<UserCheck size={11} />}>
                  Accept
                </GlassButton>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto space-y-0.5 p-2">
        {conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquare size={32} className="text-gray-600 mb-3" />
            <p className="text-sm text-gray-500">No conversation</p>
            <p className="text-xs text-gray-600 mt-1">Search for a user to start</p>
          </div>
        )}
        {conversations.map((conv) => (
          <motion.button
            key={conv.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => { setActiveConversation(conv.id); closeSidebar() }}
            className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left ${
              activeConversationId === conv.id ? 'bg-amber-400/10 border border-amber-400/15' : 'hover:bg-white/[0.04]'
            }`}
          >
            <Avatar name={conv.name || '?'} status="online" size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{conv.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {conv.encryptionEnabled && <Lock size={10} className="text-neon-cyan" />}
                  {conv.unreadCount > 0 && (
                    <span className="text-[10px] bg-neon-cyan/20 text-neon-cyan px-1.5 py-0.5 rounded-full font-medium">{conv.unreadCount}</span>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-500 truncate mt-0.5">{conv.lastMessage?.content || 'New conversation'}</p>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
