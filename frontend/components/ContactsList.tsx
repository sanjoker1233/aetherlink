'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Search, UserPlus, Radio, Wifi, Satellite, MessageSquare, User, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { GlassInput } from '@/components/ui/GlassInput'
import { GlassButton } from '@/components/ui/GlassButton'
import { AddContactModal } from './AddContactModal'
import { useStore } from '@/lib/store'
import { generateId } from '@/lib/crypto'
import type { Contact, Conversation } from '@/lib/types'

const netIcon: Record<string, React.ReactNode> = {
  lora: <Radio size={10} className="text-neon-green" />,
  wifi: <Wifi size={10} className="text-neon-blue" />,
  satellite: <Satellite size={10} className="text-neon-amber" />,
  mesh: <Radio size={10} className="text-neon-violet" />,
  internet: <Wifi size={10} className="text-gray-400" />,
}

export function ContactsList() {
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const { contacts, user, addConversation, setActiveConversation, setActiveTab, removeContact, setSidebarOpen } = useStore()

  const filtered = contacts.filter((c) =>
    c.displayName.toLowerCase().includes(search.toLowerCase())
  )

  const convId = (a: string, b: string) => [a, b].sort().join('__')

  const handleStartChat = (contact: Contact) => {
    const cid = convId(user?.id || '', contact.userId)
    const conv: Conversation = {
      id: cid,
      participants: [user?.id || '', contact.userId],
      name: contact.displayName,
      unreadCount: 0,
      encryptionEnabled: true,
      networkPreference: 'hybrid',
      updatedAt: Date.now(),
    }
    addConversation(conv)
    setActiveConversation(cid)
    setActiveTab('chats')
    if (window.innerWidth < 1024) setSidebarOpen(false)
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <GlassInput
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search size={16} />}
          />
        </div>
        <GlassButton variant="primary" size="sm" onClick={() => setShowAdd(true)} icon={<UserPlus size={16} />}>
          Add
        </GlassButton>
      </div>

      <AddContactModal open={showAdd} onClose={() => setShowAdd(false)} />

      {contacts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <User size={40} className="text-gray-600 mb-4" />
          <p className="text-sm text-gray-400 mb-1">No contact</p>
          <p className="text-xs text-gray-600 mb-4">
            Add a contact via QR code, link or fingerprint
          </p>
          <GlassButton variant="primary" size="sm" onClick={() => setShowAdd(true)} icon={<UserPlus size={14} />}>
            Add a contact
          </GlassButton>
        </div>
      )}

      <div className="space-y-1">
        {filtered.map((contact) => (
          <motion.div
            key={contact.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-all group"
          >
            <Avatar name={contact.displayName} status={contact.status || 'offline'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{contact.displayName}</span>
                {contact.network && netIcon[contact.network]}
                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                  contact.status === 'online' ? 'bg-neon-green/20 text-neon-green' :
                  contact.status === 'mesh' ? 'bg-neon-amber/20 text-neon-amber' :
                  'bg-gray-500/20 text-gray-500'
                }`}>{contact.status || 'offline'}</span>
              </div>
              <p className="text-xs text-gray-500">
                Fingerprint: {contact.publicKeyFingerprint || '—'}
              </p>
            </div>
            <button
              onClick={() => handleStartChat(contact)}
              className="glass-button p-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              title="Start a conversation"
            >
              <MessageSquare size={14} />
            </button>
            <button
              onClick={() => removeContact(contact.userId)}
              className="p-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-gray-500 hover:text-rose-400"
              title="Delete contact"
            >
              <Trash2 size={14} />
            </button>
          </motion.div>
        ))}
        {contacts.length > 0 && filtered.length === 0 && (
          <p className="text-center text-gray-500 py-8 text-sm">No result</p>
        )}
      </div>
    </div>
  )
}
