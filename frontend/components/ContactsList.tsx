'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Search, UserPlus, Radio, Wifi, Satellite, MessageSquare, User, Trash2, ShieldCheck, Users } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { GlassInput } from '@/components/ui/GlassInput'
import { GlassButton } from '@/components/ui/GlassButton'
import { AddContactModal } from './AddContactModal'
import { ContactVerifyModal } from './ContactVerifyModal'
import { CreateGroupModal } from './CreateGroupModal'
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
  const [verifyContact, setVerifyContact] = useState<Contact | null>(null)
  const [showGroup, setShowGroup] = useState(false)
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
    if (window.innerWidth < 768) setSidebarOpen(false)
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <GlassInput
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search size={16} />}
          />
        </div>
        <GlassButton variant="primary" size="sm" onClick={() => setShowAdd(true)} icon={<UserPlus size={16} />}>
          Ajouter
        </GlassButton>
        <GlassButton variant="primary" size="sm" onClick={() => setShowGroup(true)} icon={<Users size={16} />}>
          Groupe
        </GlassButton>
      </div>

      <AddContactModal open={showAdd} onClose={() => setShowAdd(false)} />
      <ContactVerifyModal contact={verifyContact} onClose={() => setVerifyContact(null)} />
      <CreateGroupModal open={showGroup} onClose={() => setShowGroup(false)} />

      {contacts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <User size={40} className="text-gray-600 mb-4" />
          <p className="text-sm text-gray-400 mb-1">Aucun contact</p>
          <p className="text-xs text-gray-600 mb-4">
            Ajoutez un contact via un QR code, un lien ou une empreinte
          </p>
          <GlassButton variant="primary" size="sm" onClick={() => setShowAdd(true)} icon={<UserPlus size={14} />}>
            Ajouter un contact
          </GlassButton>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {filtered.map((contact) => (
          <motion.div
            key={contact.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => handleStartChat(contact)}
            className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-all group cursor-pointer md:cursor-default"
          >
            <Avatar name={contact.displayName} status={contact.status || 'offline'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{contact.displayName}</span>
                {contact.verified && <ShieldCheck size={12} className="text-emerald-400 shrink-0" />}
                {contact.network && netIcon[contact.network]}
                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                  contact.status === 'online' ? 'bg-neon-green/20 text-neon-green' :
                  contact.status === 'mesh' ? 'bg-neon-amber/20 text-neon-amber' :
                  'bg-gray-500/20 text-gray-500'
                }`}>{contact.status || 'offline'}</span>
              </div>
              <p className="text-xs text-gray-500">
                Empreinte : {contact.publicKeyFingerprint || '—'}
              </p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setVerifyContact(contact) }}
              className="p-2.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0 text-amber-400 hover:text-amber-300 rounded-lg hover:bg-white/10"
              title="Vérifier le numéro de sécurité"
              aria-label="Vérifier le numéro de sécurité"
            >
              <ShieldCheck size={14} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleStartChat(contact) }}
              className="glass-button p-2.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0"
              title="Démarrer une conversation"
              aria-label="Démarrer une conversation"
            >
              <MessageSquare size={14} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); removeContact(contact.userId) }}
              className="p-2.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0 text-gray-500 hover:text-rose-400 rounded-lg hover:bg-white/10"
              title="Supprimer le contact"
              aria-label="Supprimer le contact"
            >
              <Trash2 size={14} />
            </button>
          </motion.div>
        ))}
        {contacts.length > 0 && filtered.length === 0 && (
          <p className="text-center text-gray-500 py-8 text-sm">Aucun résultat</p>
        )}
      </div>
    </div>
  )
}
