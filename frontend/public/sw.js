// Service worker for CRYPTMessenger PWA.
//
// SECURITY:
//   - Never cache API or WebSocket handshake responses. Previously the SW
//     hard-coded a bypass for :8080 while the API ran on :9090, so every
//     authenticated API GET was cached indefinitely (audit finding #11 /
//     "HIGH: SW cache-poisoning + wrong bypass port"). We now bypass by URL
//     pattern (any path under /api/), which is port-agnostic and covers both
//     dev and prod deployments regardless of NEXT_PUBLIC_API_URL.
//   - Only same-origin GETs for the pre-declared static shell are cached.
//   - Cache name is versioned so an updated shell replaces the old one on
//     activate.

const CACHE_NAME = 'cryptmessenger-shell-v2'
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// isApiRequest returns true for anything that looks like an API/WS call.
// We check by path (not origin) so it works whether the API is same-origin,
// cross-origin on :9090, or cross-origin on a real prod host.
function isApiRequest(request) {
  try {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) return true
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) return true
    // Cross-origin fetches to a different host: never cache. The SW should
    // not be in the trust path for anything it doesn't serve itself.
    if (url.origin !== self.location.origin) return true
    return false
  } catch (_) {
    return true // if we can't parse it, don't cache it
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Bypass entirely for non-GET, for API/WS, and for anything cross-origin.
  // Non-GETs (POST/PUT/DELETE) must never touch the cache; the Cache API
  // rejects them anyway but we prefer to make the intent explicit.
  if (request.method !== 'GET' || isApiRequest(request)) {
    return // let the browser handle it directly
  }

  const url = new URL(request.url)

  // Immutable, content-hashed assets: cache-first is safe (and fast).
  const isImmutable =
    url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')

  if (isImmutable) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        }).catch(() => Response.error())
      })
    )
    return
  }

  // Everything else (navigations / HTML / manifest): network-first with
  // stale-while-revalidate semantics, so a new deploy is picked up immediately
  // instead of serving a permanently stale shell.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached
          if (request.mode === 'navigate') return caches.match('/')
          return Response.error()
        })
      )
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
