# Security & Hardening Notes

This document records the security posture of aetherlink and the hardening
changes applied to the backend (Go) and frontend (Next.js).

## End-to-end encryption model
- Identity keys are generated client-side (X25519 + Ed25519). The server
  **never** sees plaintext message bodies or private keys.
- Messages are encrypted on the sender's device and only the ciphertext is
  transmitted/stored. Decryption happens locally after a tap-to-reveal gesture.
- The server is a relay + persistence layer, not a trusted party.

## Rate limiting
- `POST /api/register-init` and `/api/register-confirm` are capped by a
  token-bucket limiter (`golang.org/x/time/rate`) to stop registration floods.
- Default: burst of 10 requests, refilled every 10s. Configurable via the
  `REGISTER_RATE_LIMIT` env var (`"burst,interval"`, e.g. `"10,10s"`).
- The frontend detects HTTP `429` and shows a friendly message ("Registration
  is rate-limited. Please wait a few seconds and try again.") instead of
  entering a broken authenticated state.

## Persistence (Write-Ahead Log)
- Server-side message/contact state is persisted via an append-only WAL
  (`backend/internal/db`) with periodic checkpoints. This survives restarts
  without an external database.
- Ephemeral ("burn after read") messages: when the recipient reads an
  ephemeral message, the server deletes it and sends a `message_expire` frame
  to both conversation members so it disappears from both UIs. A background
  janitor also purges unread ephemeral messages once their TTL elapses, so they
  can never accumulate on the server.

## Contact flow
- Incoming contact requests surface via `ContactRequestBadge`; the user can
  **Accept** (establishes the shared session) or **Refuse** (emits
  `contact_decline` and removes the pending request without leaking presence).
- Accept/Refuse controls live only on the badge to avoid duplicate actions in
  the chat list.

## Push notifications
- Web Push uses VAPID. The public key is served at `/api/push/vapid` and the
  subscription endpoint at `/api/push/subscribe`. The private VAPID key and JWT
  secret are runtime secrets (`backend/.jwt.env`), never committed.

## Content-Security-Policy (current state)
- The frontend currently ships an inline-friendly CSP (`script-src 'self'
  'unsafe-inline'`) because Next.js 14.2.35 does not expose
  `experimental.cspNonce`, and middleware cannot rewrite the body of
  pre-rendered HTML routes. A strict nonce-based CSP is **not feasible
  cleanly** on this Next version; the practical trade-off is allowing inline
  scripts (all first-party) rather than breaking the app. Revisit when
  upgrading Next.js to a version that supports CSP nonces natively.
- `frame-ancestors 'none'` and `base-uri 'self'` are set to mitigate framing /
  base-tag injection.

## Testing / verification
- `frontend/e2e/ui-e2e.mjs` is the "bouclier" end-to-end gate: it registers two
  users, exchanges a contact request, sends an ephemeral + normal message, and
  validates tap-to-decrypt. Run with:
  `E2E_BASE=http://localhost:3000 node frontend/e2e/ui-e2e.mjs`
  (backend must be on :9090 with `ALLOWED_ORIGINS` allowing localhost:3000).
- `frontend/e2e/ui-e2e-decline.mjs` verifies the live `contact_decline` flow.
- `frontend/e2e/ui-e2e-ephemeral.mjs` verifies ephemeral burn-after-read: a
  🔥 message sent by Alice disappears from both conversations once Bob reads it.
- `go test ./backend/...` covers the WAL store and WS hub features.

## Secrets handling
- `backend/.jwt.env` and any `*.pem` / private keys are git-ignored. Do **not**
  commit runtime secrets.
