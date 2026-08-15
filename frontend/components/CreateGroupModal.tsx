'use client'

import { useState } from 'react'
import { useStore } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { api } from '@/lib/api'
import { GlassInput } from '@/components/ui/GlassInput'
import { GlassButton } from '@/components/ui/GlassButton'
import type { Conversation } from '@/lib/types'

export function CreateGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { contacts, addConversation, setActiveConversation, setActiveTab } = useStore()
  const t = useT()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  if (!open) return null

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const create = async () => {
    const members = Array.from(selected)
    if (members.length < 1) {
      setError(t('group.selectOne'))
      return
    }
    try {
      const conv = await api.createConversation(members, name.trim() || 'Group', 'group')
      const conversation: Conversation = {
        id: conv.id,
        participants: conv.members,
        name: conv.name || 'Group',
        unreadCount: 0,
        encryptionEnabled: true,
        networkPreference: 'hybrid',
        updatedAt: Date.now(),
      }
      addConversation(conversation)
      setActiveConversation(conv.id)
      setActiveTab('chats')
      setName('')
      setSelected(new Set())
      setError('')
      onClose()
    } catch (e) {
      setError(t('group.createFailed'))
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl border border-white/10 bg-zinc-900/95 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white">{t('group.newTitle')}</h3>
        <GlassInput
          placeholder={t('group.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="max-h-60 overflow-y-auto space-y-1">
          {contacts.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 cursor-pointer"
            >
              <input type="checkbox" checked={selected.has(c.userId)} onChange={() => toggle(c.userId)} />
              <span className="text-sm text-white">{c.displayName}</span>
            </label>
          ))}
          {contacts.length === 0 && (
            <p className="text-sm text-gray-500">{t('group.noContacts')}</p>
          )}
        </div>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <GlassButton size="sm" onClick={onClose}>
            {t('action.cancel')}
          </GlassButton>
          <GlassButton variant="primary" size="sm" onClick={create} disabled={selected.size < 1}>
            {t('action.create')}
          </GlassButton>
        </div>
      </div>
    </div>
  )
}
