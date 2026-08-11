import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Per-request CSP nonce for the Next.js-rendered app shell. The Go API sets
// its own CSP (see backend securityHeaders); this one governs the HTML/JS the
// browser actually loads. We add a nonce so first-party inline scripts can opt
// in, and keep 'unsafe-inline' ONLY because Next.js injects framework bootstrap
// scripts that are not nonce-tagged — removing it would break the app. A full
// nonce migration needs a custom Document that tags Next's own scripts.
function makeNonce(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}

export function middleware(req: NextRequest) {
  const nonce = makeNonce()
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  const res = NextResponse.next()
  res.headers.set('Content-Security-Policy', csp)
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'no-referrer')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  return res
}

export const config = {
  // Apply to pages only — never to API routes (Go owns those) or static assets.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|manifest.json|icons).*)'],
}
