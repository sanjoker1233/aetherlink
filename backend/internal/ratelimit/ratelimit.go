// Package ratelimit provides a small per-IP token-bucket rate limiter as
// chi/net-http middleware. It fixes audit finding H9 (no rate limiting on
// /api/auth/register, /api/users/search, or /api/messages, letting a single
// caller flood the JSON-store persist() path).
//
// Design notes:
//   - Backed by golang.org/x/time/rate.Limiter (standard, well-tested).
//   - One limiter per client IP, kept in an in-memory map behind a mutex.
//   - A background janitor evicts limiters that haven't been used recently,
//     so the map can't grow unbounded (trivial memory DoS otherwise).
//   - The client key is r.RemoteAddr's host portion. In production, chi's
//     middleware.RealIP (already installed in main) rewrites RemoteAddr from
//     X-Forwarded-For, so this Just Works behind a trusted reverse proxy.
//     Without a trusted proxy, X-Forwarded-For is spoofable; that's a
//     deployment concern, not something the limiter can fix.
package ratelimit

import (
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Config controls a single limiter policy.
type Config struct {
	// Rate is sustained requests per second per IP.
	Rate rate.Limit
	// Burst is the initial + refill bucket size.
	Burst int
	// IdleTTL is how long an unused per-IP limiter is kept before eviction.
	// Anything from 5–30 min is fine; longer keeps limiters warm across
	// bursts, shorter uses less memory.
	IdleTTL time.Duration
}

type entry struct {
	limiter *rate.Limiter
	seen    time.Time
}

// Limiter is a per-IP token-bucket rate limiter.
type Limiter struct {
	cfg     Config
	mu      sync.Mutex
	clients map[string]*entry
}

// New builds a Limiter and starts a background janitor.
func New(cfg Config) *Limiter {
	if cfg.IdleTTL == 0 {
		cfg.IdleTTL = 10 * time.Minute
	}
	l := &Limiter{cfg: cfg, clients: make(map[string]*entry)}
	go l.janitor()
	return l
}

// clientIP extracts a stable client identifier. chi's middleware.RealIP will
// have already rewritten r.RemoteAddr from X-Forwarded-For when behind a
// trusted proxy. We SplitHostPort so `1.2.3.4:5678` -> `1.2.3.4`.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// get returns (or creates) the limiter for a given IP and marks it recently used.
func (l *Limiter) get(ip string) *rate.Limiter {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.clients[ip]
	if !ok {
		e = &entry{limiter: rate.NewLimiter(l.cfg.Rate, l.cfg.Burst)}
		l.clients[ip] = e
	}
	e.seen = time.Now()
	return e.limiter
}

// janitor sweeps the map for stale entries. Runs at IdleTTL/2 cadence.
func (l *Limiter) janitor() {
	interval := l.cfg.IdleTTL / 2
	if interval < time.Minute {
		interval = time.Minute
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for range t.C {
		cutoff := time.Now().Add(-l.cfg.IdleTTL)
		l.mu.Lock()
		for ip, e := range l.clients {
			if e.seen.Before(cutoff) {
				delete(l.clients, ip)
			}
		}
		l.mu.Unlock()
	}
}

// Middleware returns net/http middleware that enforces the limiter's policy
// and emits a 429 with a Retry-After hint when the caller is over-budget.
func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lim := l.get(clientIP(r))
		if !lim.Allow() {
			// Retry-After is a coarse hint; a full-precision value would
			// require polling the reservation, which isn't worth the churn.
			w.Header().Set("Retry-After", "1")
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
