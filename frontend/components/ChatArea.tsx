'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Lock, Unlock, ChevronLeft, Paperclip, AlertCircle, CheckCheck, FileText, Image, X } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { GlassButton } from '@/components/ui/GlassButton'
import { useStore } from '@/lib/store'
import { wsManager } from '@/lib/ws-client'
import type { Message } from '@/lib/types'

export function ChatArea() {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<{ name: string; type: string; data: string }[]>([])
  const [showAttach, setShowAttach] = useState(false)
  const [unlockedIds, setUnlockedIds] = useState<Record<string, boolean>>({})
  const unlockTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const processedIds = useRef<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { activeConversationId, setActiveConversation, setSelectedMessage, messages, user, conversations, settings } = useStore()

  const currentMessages = activeConversationId ? (messages[activeConversationId] || []) : []
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
      processedIds.current.add(msg.id)
      setUnlockedIds((prev) => ({ ...prev, [msg.id]: true }))
      unlockTimers.current[msg.id] = setTimeout(() => {
        setUnlockedIds((prev) => ({ ...prev, [msg.id]: false }))
        delete unlockTimers.current[msg.id]
      }, duration)
    })
  }, [currentMessages, settings.decryptDuration])

  const handleSend = () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || !activeConversationId) return
    const fullText = attachments.length > 0
      ? text + '\n' + attachments.map(a => `[${a.type === 'image' ? '📷' : '📎'} ${a.name}]`).join('\n')
      : text
    wsManager.sendEncryptedMessage(activeConversationId, fullText)
    setInput(''); setAttachments([]); setShowAttach(false)
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
    const becomingUnlocked = !unlockedIds[msgId]
    setUnlockedIds(prev => ({ ...prev, [msgId]: becomingUnlocked }))
    if (becomingUnlocked && settings.decryptDuration > 0) {
      unlockTimers.current[msgId] = setTimeout(() => {
        setUnlockedIds(prev => ({ ...prev, [msgId]: false }))
        delete unlockTimers.current[msgId]
      }, settings.decryptDuration)
    }
  }

  const displayContent = (msg: Message) => {
    const isUnlocked = unlockedIds[msg.id]
    if (msg.encrypted && !isUnlocked) {
      const truncated = msg.content.slice(0, 80) + (msg.content.length > 80 ? '...' : '')
      return `[ENCRYPTED] ${truncated}`
    }
    if (msg.encrypted && isUnlocked && msg.plainContent) {
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
          <p className="text-[#a3866a] text-sm">RSA-4096 + AES-256-GCM encryption<br/>End-to-end messages</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      <div className="glass-panel mx-2 mt-2 px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => setActiveConversation(null)} className="lg:hidden text-gray-400 hover:text-white">
          <ChevronLeft size={20} />
        </button>
        <Avatar name={activeConv?.name || 'Contact'} status="online" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{activeConv?.name || 'Contact'}</span>
            <span className="encryption-badge text-[10px]"><Lock size={10} /> E2EE</span>
          </div>
          <p className="text-xs text-emerald-500">
            {activeConv?.encryptionEnabled ? 'End-to-end encrypted' : ''}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <AnimatePresence>
          {currentMessages.map((msg) => {
            const isEncrypted = msg.encrypted
            const isUnlocked = unlockedIds[msg.id]
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
                } ${isEncrypted && !isUnlocked ? 'opacity-80' : ''}`}
                onClick={() => setSelectedMessage({ convId: activeConversationId!, msg })}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      isEncrypted && !isUnlocked ? 'font-mono text-xs text-amber-400/70' : 'text-[#f5e6d3]'
                    }`}>
                      {content}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1.5 mt-1.5">
                  {showDecryptToggle && (
                    <motion.button
                      onClick={(e) => { e.stopPropagation(); toggleDecrypt(msg.id) }}
                      className={`p-1 rounded-md transition-all ${
                        isUnlocked
                          ? 'bg-amber-400/20 text-amber-400'
                          : 'text-gray-500 hover:text-amber-400'
                      }`}
                      whileTap={{ scale: 0.9 }}
                      title={isUnlocked ? 'Hide (encrypt)' : 'Decrypt'}
                    >
                      {isUnlocked ? <Unlock size={12} /> : <Lock size={12} />}
                    </motion.button>
                  )}
                  {!showDecryptToggle && isEncrypted && (
                    <Lock size={10} className="text-amber-400/50" />
                  )}
                  <span className="text-[10px] text-gray-500">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {msg.senderId === user?.id && statusIcon(msg.status)}
                </div>

                {isEncrypted && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                      isUnlocked
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : 'bg-amber-400/10 text-amber-400'
                    }`}>
                      {isUnlocked ? 'Decrypted' : 'Encrypted'}
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

      <div className="p-3 border-t border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => fileInputRef.current?.click()} className="glass-button p-2.5 shrink-0"><Paperclip size={18} /></button>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.doc,.docx" className="hidden" onChange={handleFileSelect} />
          </div>
          <div className="flex-1 relative">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
              placeholder="E2E encrypted message..."
              className="glass-input w-full pr-4"
            />
          </div>
          <GlassButton variant="primary" size="md" onClick={handleSend} icon={<Send size={16} />}>
            Send
          </GlassButton>
        </div>
      </div>
    </div>
  )
}

function CheckIcon(props: any) { return <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20,6 9,17 4,12"/></svg> }
