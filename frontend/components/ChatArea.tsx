'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Lock, Unlock, ChevronLeft, Paperclip, AlertCircle, CheckCheck, FileText, Image, X, Search, Flame } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { GlassButton } from '@/components/ui/GlassButton'
import { useStore } from '@/lib/store'
import { wsManager } from '@/lib/ws-client'
import { api } from '@/lib/api'
import type { Message } from '@/lib/types'

export function ChatArea() {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<{ name: string; type: string; data: string }[]>([])
  const [showAttach, setShowAttach] = useState(false)
  // Messages are readable (decrypted) by default. `lockedIds` tracks messages
  // the user explicitly hid, or that auto-re-locked after decryptDuration.
  const [lockedIds, setLockedIds] = useState<Record<string, boolean>>({})
  const unlockTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const processedIds = useRef<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastTypingRef = useRef(0)
  const [search, setSearch] = useState('')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  // Per-message 🔥 toggle: when on, the next message is sent as a
  // disappearing ("burn after read") message. Reset after each send.
  const [ephemeralOn, setEphemeralOn] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadingOlderRef = useRef(false)
  const hasMoreRef = useRef(true)
  const { activeConversationId, setActiveConversation, setSelectedMessage, messages, user, conversations, settings, typing } = useStore()

  const currentMessages = activeConversationId ? (messages[activeConversationId] || []) : []
  const visibleMessages = search
    ? currentMessages.filter((m) => (m.plainContent || m.content || '').toLowerCase().includes(search.toLowerCase()))
    : currentMessages
  const isPeerTyping = activeConversationId ? !!typing[activeConversationId] : false
  const activeConv = conversations.find((c) => c.id === activeConversationId)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages])

  useEffect(() => {
    return () => {
      Object.values(unlockTimers.current).forEach(clearTimeout)
      unlockTimers.current = {}
    }
  }, [])

  useEffect(() => {
    const duration = settings.decryptDuration
    if (duration <= 0) return
    currentMessages.forEach((msg) => {
      if (processedIds.current.has(msg.id)) return
      if (!msg.encrypted || !msg.plainContent) return
      // Visible by default; auto re-lock (hide) after the chosen duration.
      processedIds.current.add(msg.id)
      unlockTimers.current[msg.id] = setTimeout(() => {
        setLockedIds((prev) => ({ ...prev, [msg.id]: true }))
        delete unlockTimers.current[msg.id]
      }, duration)
    })
  }, [currentMessages, settings.decryptDuration])

  // Read receipts ("Vu"): when this conversation is open, flag the incoming
  // (not-our-own) messages as seen and tell their original sender.
  useEffect(() => {
    if (!activeConversationId || !user) return
    const incoming = currentMessages.filter((m) => m.senderId !== user.id && !m.read)
    if (incoming.length === 0) return
    const ids = incoming.map((m) => m.id)
    const senderId = incoming[0].senderId
    wsManager.sendReadReceipt(activeConversationId, ids, senderId)
    // Reflect locally so we don't re-send the same receipt on every render.
    useStore.getState().markMessagesRead(activeConversationId, ids)
  }, [activeConversationId, currentMessages, user])

  // Pagination: load older history from the server when the user scrolls to the
  // top of the thread. The backend caps pages (GET /api/messages?limit&before),
  // so we stop once a page returns fewer than the limit.
  const loadOlderMessages = async () => {
    if (!activeConversationId || loadingOlderRef.current || !hasMoreRef.current) return
    const msgs = useStore.getState().messages[activeConversationId] || []
    if (msgs.length === 0) return
    const oldest = Math.min(...msgs.map((m) => m.timestamp || Date.now()))
    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const older = await api.getMessages(activeConversationId, { limit: 50, before: oldest })
      if (Array.isArray(older) && older.length > 0) {
        useStore.getState().prependMessages(activeConversationId, older)
        const more = older.length >= 50
        setHasMoreHistory(more)
        hasMoreRef.current = more
      } else {
        setHasMoreHistory(false); hasMoreRef.current = false
      }
    } catch {
      setHasMoreHistory(false); hasMoreRef.current = false
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop < 80 && !loadingOlderRef.current && hasMoreRef.current) {
      void loadOlderMessages()
    }
  }

  // Reset pagination state whenever the active conversation changes.
  useEffect(() => {
    setHasMoreHistory(true); hasMoreRef.current = true
    setLoadingOlder(false); loadingOlderRef.current = false
  }, [activeConversationId])

  const handleSend = () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || !activeConversationId) return
    const fullText = attachments.length > 0
      ? text + '\n' + attachments.map(a => `[${a.type === 'image' ? '📷' : '📎'} ${a.name}]`).join('\n')
      : text
    wsManager.sendEncryptedMessage(activeConversationId, fullText, { ephemeral: ephemeralOn })
    const peer = activeConv?.participants.find((p) => p !== user?.id)
    if (peer) wsManager.sendTyping(activeConversationId!, peer, false)
    setInput(''); setAttachments([]); setShowAttach(false); setEphemeralOn(false)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
    if (!activeConversationId || !activeConv) return
    const peer = activeConv.participants.find((p) => p !== user?.id)
    if (!peer) return
    if (!settings.typingEnabled) return
    const now = Date.now()
    if (now - lastTypingRef.current > 2000) {
      lastTypingRef.current = now
      wsManager.sendTyping(activeConversationId, peer, true)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || file.size > 10 * 1024 * 1024) return
    const reader = new FileReader()
    reader.onload = () => {
      setAttachments(prev => [...prev, {
        name: file.name,
        type: file.type.startsWith('image/') ? 'image' : 'file',
        data: reader.result as string,
      }])
    }
    reader.readAsDataURL(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const statusIcon = (s: Message['status']) => {
    switch (s) {
      case 'sending': return <Send size={10} className="text-gray-500" />
      case 'sent': return <CheckIcon size={10} className="text-gray-400" />
      case 'delivered': return <CheckCheck size={10} className="text-amber-400" />
      case 'failed': return <AlertCircle size={10} className="text-rose-400" />
    }
  }

  const clearTimer = (msgId: string) => {
    if (unlockTimers.current[msgId]) {
      clearTimeout(unlockTimers.current[msgId])
      delete unlockTimers.current[msgId]
    }
  }

  const toggleDecrypt = (msgId: string) => {
    clearTimer(msgId)
    const becomingLocked = !lockedIds[msgId]
    setLockedIds(prev => ({ ...prev, [msgId]: becomingLocked }))
    // If we just revealed it and a duration is set, auto re-lock after it.
    if (!becomingLocked && settings.decryptDuration > 0) {
      unlockTimers.current[msgId] = setTimeout(() => {
        setLockedIds(prev => ({ ...prev, [msgId]: true }))
        delete unlockTimers.current[msgId]
      }, settings.decryptDuration)
    }
  }

  const displayContent = (msg: Message) => {
    const isLocked = !!lockedIds[msg.id]
    if (msg.encrypted && isLocked) {
      const truncated = msg.content.slice(0, 80) + (msg.content.length > 80 ? '...' : '')
      return `[ENCRYPTED] ${truncated}`
    }
    if (msg.encrypted && !isLocked && msg.plainContent) {
      return msg.plainContent
    }
    return msg.content
  }

  if (!activeConversationId) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
            className="w-24 h-24 rounded-3xl glass-card flex items-center justify-center mx-auto mb-6">
            <Lock size={40} className="text-amber-400" />
          </motion.div>
          <h2 className="text-xl font-semibold mb-2 neon-text">CRYPTMessenger</h2>
          <p className="text-[#a3866a] text-sm">Chiffrement RSA-4096 + AES-256-GCM<br/>Messages de bout en bout</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      <div className="glass-panel mx-2 mt-2 px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => setActiveConversation(null)} className="md:hidden text-gray-400 hover:text-white">
          <ChevronLeft size={20} />
        </button>
        <Avatar name={activeConv?.name || 'Contact'} status="online" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{activeConv?.name || 'Contact'}</span>
            <span className="encryption-badge text-[10px]"><Lock size={10} /> E2EE</span>
          </div>
          <p className="text-xs text-amber-400">
            {isPeerTyping ? 'écrit…' : activeConv?.encryptionEnabled ? 'Chiffré de bout en bout' : ''}
          </p>
        </div>
        <div className="relative shrink-0 hidden sm:block">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher…"
            aria-label="Rechercher les messages"
            className="glass-input pl-7 py-1 text-xs w-28 focus:w-44 transition-all"
          />
        </div>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-3">
        {loadingOlder && (
          <div className="text-center text-[10px] text-gray-500 py-1">Chargement des messages précédents…</div>
        )}
        <AnimatePresence>
          {visibleMessages.map((msg) => {
            const isEncrypted = msg.encrypted
            const isLocked = !!lockedIds[msg.id]
            const showDecryptToggle = isEncrypted && !!msg.plainContent
            const content = displayContent(msg)

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`message-bubble cursor-pointer transition-shadow hover:shadow-lg ${
                  msg.senderId === user?.id ? 'sent' : 'received'
                } ${isEncrypted && isLocked ? 'opacity-80' : ''}`}
                onClick={() => setSelectedMessage({ convId: activeConversationId!, msg })}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      isEncrypted && isLocked ? 'font-mono text-xs text-amber-400/70' : 'text-[#f5e6d3]'
                    }`}>
                      {content}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1.5 mt-1.5">
                  {showDecryptToggle && (
                    <motion.button
                      onClick={(e) => { e.stopPropagation(); toggleDecrypt(msg.id) }}
                      className={`p-1.5 rounded-md transition-all min-w-[32px] min-h-[32px] flex items-center justify-center ${
                        isLocked
                          ? 'text-gray-500 hover:text-amber-400'
                          : 'bg-amber-400/20 text-amber-400'
                      }`}
                      whileTap={{ scale: 0.9 }}
                      title={isLocked ? 'Déchiffrer' : 'Masquer (chiffrer)'}
                    >
                      {isLocked ? <Lock size={12} /> : <Unlock size={12} />}
                    </motion.button>
                  )}
                  {!showDecryptToggle && isEncrypted && (
                    <Lock size={10} className="text-amber-400/50" />
                  )}
                  {msg.ephemeral && (
                    <Flame size={10} className="text-orange-400/70" />
                  )}
                  <span className="text-[10px] text-gray-500">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {msg.senderId === user?.id && (
                    msg.read
                      ? <span className="flex items-center gap-0.5 text-[10px] text-sky-400"><CheckCheck size={12} /> Vu</span>
                      : statusIcon(msg.status)
                  )}
                </div>

                {isEncrypted && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                      isLocked
                        ? 'bg-amber-400/10 text-amber-400'
                        : 'bg-emerald-500/10 text-emerald-500'
                    }`}>
                      {isLocked ? 'Chiffré' : 'Déchiffré'}
                    </span>
                  </div>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {attachments.length > 0 && (
        <div className="px-3 pb-2 flex gap-2 overflow-x-auto">
          {attachments.map((att, i) => (
            <div key={i} className="glass-panel p-2 flex items-center gap-2 shrink-0 max-w-[200px]">
              {att.type === 'image' ? <Image size={14} className="text-amber-400" /> : <FileText size={14} className="text-orange-400" />}
              <span className="text-xs truncate">{att.name}</span>
              <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-gray-500 hover:text-white shrink-0">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="p-3 pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)] border-t border-white/5 shrink-0">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); handleSend() }}
        >
          <div className="relative">
            <button type="button" aria-label="Attach a file" onClick={() => fileInputRef.current?.click()} className="glass-button p-2.5 shrink-0"><Paperclip size={18} /></button>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.doc,.docx" className="hidden" onChange={handleFileSelect} />
          </div>
          <button
            type="button"
            aria-label="Disappearing message"
            title={ephemeralOn ? 'Message éphémère : disparaît après lecture' : 'Rendre ce message éphémère (disparaît après lecture)'}
            onClick={() => setEphemeralOn((v) => !v)}
            className={`glass-button p-2.5 shrink-0 transition-colors ${ephemeralOn ? 'text-orange-400 bg-orange-500/15 border-orange-400/40' : 'text-gray-400'}`}
          >
            <Flame size={18} />
          </button>
          <div className="flex-1 relative">
            <input
              value={input}
              aria-label="Message"
              onChange={handleInputChange}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
              placeholder="Message chiffré E2E…"
              className="glass-input w-full pr-4 text-base"
            />
          </div>
          <GlassButton type="submit" variant="primary" size="md" icon={<Send size={16} />}>
            Envoyer
          </GlassButton>
        </form>
      </div>
    </div>
  )
}

function CheckIcon(props: any) { return <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20,6 9,17 4,12"/></svg> }
