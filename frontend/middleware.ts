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
  const isProd = process.env.NODE_ENV === 'production'

  // Next.js dev wraps client modules in eval(...) (webpack devtool), so the
  // app shell cannot hydrate without 'unsafe-eval'. Production builds do NOT
  // use eval, so we only relax this in dev to keep prod CSP strict.
  const scriptSrc = [`'self'`, `'nonce-${nonce}'`, `'unsafe-inline'`]
  if (!isProd) scriptSrc.push(`'unsafe-eval'`)

  // The frontend talks to the Go API, which is served from a different origin
  // (another host/port). 'self' alone blocks those fetch/XHR calls. Allow the
  // configured API origin (and its ws: counterpart) so register/login/etc. work.
  const apiOrigin = (() => {
    try {
      const u = new URL(process.env.NEXT_PUBLIC_API_URL || '')
      return u.origin
    } catch {
      return ''
    }
  })()
  const connectSrc = [`'self'`, `ws:`, `wss:`]
  if (apiOrigin) connectSrc.push(apiOrigin)

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc.join(' ')}`,
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
