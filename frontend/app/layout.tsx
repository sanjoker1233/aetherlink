import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'
import { ParticleBackground } from '@/components/ui/ParticleBackground'
import { NetworkBar } from '@/components/NetworkBar'
import { Sidebar } from '@/components/Sidebar'
import { WSInit } from '@/components/WSInit'
import { SWRegister } from '@/components/SWRegister'
import { LangSync } from '@/components/LangSync'
import { PWAInstall } from '@/components/PWAInstall'
import { ConnectionBanner } from '@/components/ConnectionBanner'
import { ContactRequestBadge } from '@/components/ContactRequestBadge'
import { MessageDetail } from '@/components/MessageDetail'
import { NavSync } from '@/components/NavSync'
import { StoreHydrator } from '@/components/StoreHydrator'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ServerGuard } from '@/components/ServerGuard'
import { BottomNav } from '@/components/BottomNav'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'CRYPTMessenger — Encrypted Off-Grid Communication',
  description: 'Multi-network encrypted messaging. LoRaWAN, Meshtastic, Satellite.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'CRYPTMessenger' },
  icons: { icon: '/icons/icon.svg', apple: '/icons/icon.svg' },
}

export const viewport: Viewport = {
  // WCAG 1.4.4: do not block user zoom.
  width: 'device-width', initialScale: 1, themeColor: '#120c0a',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Per-request CSP nonce (set by middleware on the `x-nonce` request header).
  // React 19 forwards this `nonce` to every <script> it renders — including
  // Next's RSC/flight inline scripts — so they satisfy the strict CSP.
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <html lang="en" className="dark" nonce={nonce}>
      <body className={`${inter.variable} font-sans`}>
        <ParticleBackground />
        <StoreHydrator />
        <NavSync />
        <WSInit />
        <SWRegister />
        <LangSync />
        <ConnectionBanner />
        <ContactRequestBadge />
        <MessageDetail />
        <ServerGuard>
          <div className="relative z-10 flex app-shell overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <NetworkBar />
              <main className="flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)_+_4rem)] md:pb-0">
                <ErrorBoundary>{children}</ErrorBoundary>
              </main>
            </div>
          </div>
        </ServerGuard>
        <BottomNav />
      </body>
    </html>
  )
}
