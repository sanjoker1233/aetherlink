import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ParticleBackground } from '@/components/ui/ParticleBackground'
import { NetworkBar } from '@/components/NetworkBar'
import { Sidebar } from '@/components/Sidebar'
import { WSInit } from '@/components/WSInit'
import { SWRegister } from '@/components/SWRegister'
import { ContactRequestBadge } from '@/components/ContactRequestBadge'
import { MessageDetail } from '@/components/MessageDetail'
import { NavSync } from '@/components/NavSync'
import { StoreHydrator } from '@/components/StoreHydrator'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ServerGuard } from '@/components/ServerGuard'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'CRYPTMessenger — Encrypted Off-Grid Communication',
  description: 'Multi-network encrypted messaging. LoRaWAN, Meshtastic, Satellite.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'CRYPTMessenger' },
  icons: { icon: '/icons/icon.svg', apple: '/icons/icon.svg' },
}

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, themeColor: '#120c0a',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans`}>
        <ParticleBackground />
        <StoreHydrator />
        <NavSync />
        <WSInit />
        <SWRegister />
        <ContactRequestBadge />
        <MessageDetail />
        <ServerGuard>
          <div className="relative z-10 flex h-screen overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <NetworkBar />
              <main className="flex-1 overflow-y-auto">
                <ErrorBoundary>{children}</ErrorBoundary>
              </main>
            </div>
          </div>
        </ServerGuard>
      </body>
    </html>
  )
}
