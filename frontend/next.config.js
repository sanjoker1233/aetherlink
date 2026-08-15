/** @type {import('next').NextConfig} */

// NOTE: the Content-Security-Policy is now emitted per-request by
// middleware.ts (with a fresh nonce) so we can drop 'unsafe-inline' for
// scripts. The static, non-HTML security headers below still apply to every
// route (including assets the middleware matcher excludes).
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
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        // X-XSS-Protection is obsolete and can *introduce* XSS on old browsers.
        { key: 'X-XSS-Protection', value: '0' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
        },
        // HSTS: browsers ignore it over plain HTTP, so it's safe to always send.
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
        // COOP/CORP harden against cross-origin leaks (Spectre, tab-nabbing).
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
      ],
    },
  ],
}

module.exports = nextConfig
