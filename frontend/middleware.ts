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

// Derive the API http/ws origins from NEXT_PUBLIC_API_URL. This mirrors
// next.config.js so dev and prod share one source of truth for connect-src
// (no more wildcard `ws: wss:` that lets any websocket origin connect).
function apiOrigins(): { http: string; ws: string } {
  const fallback = { http: 'http://localhost:9090', ws: 'ws://localhost:9090' }
  try {
    const u = new URL(process.env.NEXT_PUBLIC_API_URL || '')
    return {
      http: `${u.protocol}//${u.host}`,
      ws: `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`,
    }
  } catch {
    return fallback
  }
}

export function middleware(req: NextRequest) {
  const nonce = makeNonce()
  const isProd = process.env.NODE_ENV === 'production'

  // Next.js dev wraps client modules in eval(...) (webpack devtool), so the
  // app shell cannot hydrate without 'unsafe-eval'. Production builds do NOT
  // use eval, so we only relax this in dev to keep prod CSP strict.
  const scriptSrc = [`'self'`, `'nonce-${nonce}'`, `'unsafe-inline'`]
  if (!isProd) scriptSrc.push(`'unsafe-eval'`)

  // Tighten connect-src to the concrete API origin instead of the wildcard
  // `ws: wss:` — a random `ws://` origin must NOT be able to open a socket.
  const { http: apiHttp, ws: apiWs } = apiOrigins()
  const connectSrc = [`'self'`, apiHttp, apiWs]

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc.join(' ')}`,
    "font-src 'self' data:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // upgrade-insecure-requests is a no-op on http:// pages but pins HTTPS
    // once the app is served over TLS.
    'upgrade-insecure-requests',
  ].join('; ')

  const res = NextResponse.next()
  res.headers.set('Content-Security-Policy', csp)
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'no-referrer')
  res.headers.set('X-Frame-Options', 'DENY')
  // X-XSS-Protection is obsolete and can *introduce* XSS on old browsers.
  // Explicitly set to 0 to override any upstream default.
  res.headers.set('X-XSS-Protection', '0')
  res.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  )
  // HSTS: browsers ignore it over plain HTTP, so it's safe to always send.
  // Once served over HTTPS this pins the origin to HTTPS for two years.
  res.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload',
  )
  // COOP/CORP harden against cross-origin leaks (Spectre, tab-nabbing).
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  res.headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  return res
}

export const config = {
  // Apply to pages only — never to API routes (Go owns those) or static assets.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|manifest.json|icons).*)'],
}
