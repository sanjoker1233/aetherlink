'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { clsx } from 'clsx'
import {
  MessageSquare,
  Users,
  Radio,
  Settings,
  ChevronLeft,
  Lock,
  Menu,
  LogOut,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { wsManager } from '@/lib/ws-client'
import type { TabType } from '@/lib/types'

const navItems: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'chats', label: 'Messages', icon: <MessageSquare size={20} /> },
  { id: 'contacts', label: 'Contacts', icon: <Users size={20} /> },
  { id: 'network', label: 'Network', icon: <Radio size={20} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={20} /> },
]

const EXPANDED = 240
const COLLAPSED = 72

export function Sidebar() {
  const { activeTab, setActiveTab, isSidebarOpen, setSidebarOpen, isAuthenticated, user, contactRequests, logout } = useStore()
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const sidebarWidth = isSidebarOpen ? EXPANDED : (isMobile ? 0 : COLLAPSED)
  const sidebarOpacity = isSidebarOpen ? 1 : (isMobile ? 0 : 1)

  return (
    <>
      {isMobile && isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {isMobile && (
        <button
          onClick={() => setSidebarOpen(!isSidebarOpen)}
          className="fixed top-4 left-4 z-50 glass-button p-2.5 rounded-xl"
          aria-label="Toggle menu"
        >
          <Menu size={20} />
        </button>
      )}

      <AnimatePresence mode="wait">
        {(isSidebarOpen || !isMobile) && (
          <motion.aside
            initial={false}
            animate={{
              width: sidebarWidth,
              opacity: sidebarOpacity,
            }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className={clsx(
              'flex flex-col glass-panel m-2 rounded-2xl overflow-hidden shrink-0',
              isMobile ? 'absolute z-40' : 'relative z-auto',
            )}
          >
            <div className="p-4 flex items-center justify-between border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-neon-cyan via-neon-violet to-neon-magenta flex items-center justify-center">
                  <Lock size={16} className="text-white" />
                </div>
                <AnimatePresence>
                  {isSidebarOpen && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      className="font-bold neon-text"
                    >
                      CRYPTM
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              {!isMobile && (
                <button
                  onClick={() => setSidebarOpen(!isSidebarOpen)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <ChevronLeft size={18} className={clsx('transition-transform', !isSidebarOpen && 'rotate-180')} />
                </button>
              )}
            </div>

            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => (
                <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id)
                if (isMobile) setSidebarOpen(false)
              }}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200',
                activeTab === item.id
                  ? 'bg-amber-400/10 text-amber-300 border border-amber-400/15 shadow-glass-sm'
                  : 'text-[#a3866a] hover:text-[#f5e6d3] hover:bg-white/[0.04]'
              )}
            >
              <span className={clsx(
                'shrink-0 relative',
                activeTab === item.id && 'text-amber-400'
              )}>
                {item.icon}
                {item.id === 'chats' && contactRequests.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-500 rounded-full text-[9px] font-bold flex items-center justify-center text-white">
                    {contactRequests.length}
                  </span>
                )}
              </span>
              <AnimatePresence>
                {isSidebarOpen && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-sm font-medium"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
              ))}
            </nav>

            <div className="p-3 border-t border-white/10">
              {isAuthenticated && user ? (
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-neon-cyan/30 to-neon-violet/30 flex items-center justify-center text-xs font-bold shrink-0">
                    {user.displayName[0]}
                  </div>
                  <AnimatePresence>
                    {isSidebarOpen && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex-1 min-w-0"
                      >
                        <p className="text-sm font-medium truncate">{user.displayName}</p>
                        <p className="text-xs text-gray-500 truncate">{user.publicKeyFingerprint}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <button
                    onClick={() => { wsManager.disconnect(); logout() }}
                    className="text-[#a3866a] hover:text-rose-400 transition-colors shrink-0"
                    title="Sign out"
                  >
                    <LogOut size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                    <LogOut size={14} className="text-gray-500" />
                  </div>
                  <AnimatePresence>
                    {isSidebarOpen && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-sm text-gray-500"
                      >
                        Not connected
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}
