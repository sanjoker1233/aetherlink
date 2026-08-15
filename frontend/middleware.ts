import { NextRequest, NextResponse } from 'next/server'

// --- Strict CSP with a per-request nonce -------------------------------
// Next.js 15 automatically tags its own framework (hydration) inline scripts
// with the nonce when it finds one in the Content-Security-Policy header, so
// we can drop 'unsafe-inline' for scripts entirely. The nonce is also echoed
// in `x-nonce` so server components can tag any custom scripts if needed.
//
// NEXT_PUBLIC_API_URL is a build-time env; derive its http/https origin and
// the matching ws/wss origin so connect-src is tight but not broken.
const rawApi = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090'
let apiHttp = 'http://localhost:9090'
let apiWs = 'ws://localhost:9090'
try {
  const u = new URL(rawApi)
  apiHttp = `${u.protocol}//${u.host}`
  apiWs = `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`
} catch (_) {
  // keep defaults
}

export function middleware(request: NextRequest) {
  // crypto.randomUUID() is the Web Crypto global, available in the Edge
  // Runtime where middleware executes (no Node 'crypto' module there).
  const nonce = crypto.randomUUID().replace(/-/g, '')

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self' ${apiHttp} ${apiWs}`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // CRITICAL: Next.js 15 reads the nonce from the *request* header
  // `content-security-policy` (see next/dist/server/render.js and
  // app-render/app-render.js) to stamp its own inline RSC/flight scripts.
  // Setting it only on the response is NOT enough — the scripts would stay
  // un-nonced and get blocked. We set it on both request and response.
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  // X-XSS-Protection is obsolete and can introduce XSS on old browsers.
  response.headers.set('X-XSS-Protection', '0')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
  )
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload'
  )
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin')

  return response
}

export const config = {
  matcher: [
    // Apply to all HTML routes; let static assets, the API and the service
    // worker through without a CSP (they aren't HTML documents).
    '/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|robots.txt).*)',
  ],
}
