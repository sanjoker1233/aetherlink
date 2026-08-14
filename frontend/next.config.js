/** @type {import('next').NextConfig} */

// --- CSP builder --------------------------------------------------------
// NEXT_PUBLIC_API_URL is a build-time env; derive its http/https origin and the
// matching ws/wss origin so connect-src is tight but not broken. If the env
// isn't set we fall back to localhost defaults so `next dev` still works.
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

// Next.js App Router injects inline bootstrap scripts that we cannot nonce-tag
// without a custom Document, so script-src must allow 'unsafe-inline' for the
// app to hydrate. User content is rendered as escaped text via React, so the
// inline-script XSS surface is negligible. (style-src keeps 'unsafe-inline'
// because Next injects inline <style> blocks.)
//
// NOTE: dropping 'unsafe-inline' for a real nonce-based CSP requires either
// Next's experimental.cspNonce (absent in 14.2.35 — middleware body rewrites
// are ignored for prerendered/static routes) or forcing pages dynamic. Tracked
// as a future hardening once Next is upgraded.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiHttp} ${apiWs}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // upgrade-insecure-requests is a no-op on http:// pages but useful once
  // the app is served over HTTPS.
  'upgrade-insecure-requests',
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // X-XSS-Protection is obsolete and can *introduce* XSS on old browsers.
  // Explicitly set to 0 to override any upstream default.
  { key: 'X-XSS-Protection', value: '0' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  // HSTS: browsers ignore it over plain HTTP, so it's safe to always send.
  // Once served over HTTPS this pins the origin to HTTPS for two years.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // COOP/CORP harden against cross-origin leaks (Spectre, tab-nabbing).
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
]

const nextConfig = {
  output: 'standalone',
  // Removes the `X-Powered-By: Next.js` header — no reason to advertise the
  // framework + version to attackers scanning for known CVEs.
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    domains: [],
  },
  headers: async () => [
    {
      source: '/:path*',
      headers: securityHeaders,
    },
  ],
}

module.exports = nextConfig
