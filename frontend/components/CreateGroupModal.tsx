'use client'

import { useState } from 'react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { GlassInput } from '@/components/ui/GlassInput'
import { GlassButton } from '@/components/ui/GlassButton'
import type { Conversation } from '@/lib/types'

export function CreateGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { contacts, addConversation, setActiveConversation, setActiveTab } = useStore()
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
      setError('Pick at least one contact.')
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
      setError('Could not create group.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900/95 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white">New group</h3>
        <GlassInput
          placeholder="Group name"
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
            <p className="text-sm text-gray-500">Add contacts first.</p>
          )}
        </div>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <GlassButton size="sm" onClick={onClose}>
            Cancel
          </GlassButton>
          <GlassButton variant="primary" size="sm" onClick={create} disabled={selected.size < 1}>
            Create
          </GlassButton>
        </div>
      </div>
    </div>
  )
}
