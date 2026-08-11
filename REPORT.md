# AetherLink — Rapport de fonctionnement & hébergement

_Doc rédigé le 10/08/2026. État : modifications appliquées en local, NON commitées/pushées, builds de prod non lancés (conformément à la demande). Voir aussi `HOSTING.md` pour le déploiement._

---

## 1. Fonctionnement (architecture)

AetherLink est une messagerie **E2E chiffrée**, **offline-first**, pensée pour le P2P / réseaux alternatifs (LoRa, mesh, satellite).

### Composants
- **Frontend** : Next.js 14 (App Router), SPA client. Pas d'API route côté Next — il consomme uniquement le backend via `NEXT_PUBLIC_API_URL`. État global via Zustand. Build/CSS en Tailwind.
- **Backend** : Go (chi router, gorilla/websocket, golang-jwt). Écoute HTTP sur `:9090` + WebSocket `/ws`. Persistance dans un fichier JSON (`DATA_DIR`, défaut `./data`, permissions 0600).
- **Transports prévus** : Internet (WS), LoRa, Meshtastic, satellite, WiFi, hybride. Les ponts LoRa/meshtastic sont désactivés par défaut (`Enabled: false`).

### Flux d'authentification (nouveau — preuve de possession)
1. Le client génère localement une paire **RSA-OAEP 4096** (clé privée **non-extractable**, stockée dans IndexedDB).
2. `POST /api/auth/register-init {displayName, publicKey}` → le serveur **valide la clé publique** (RSA ≥ 2048), **vérifie l'absence de doublon** (clé publique / nom déjà pris), génère un nonce aléatoire de 32 octets, le **chiffre avec la clé publique du client (RSA-OAEP/SHA-256)** et renvoie le défi chiffré + un `pendingId` (TTL 10 min).
3. Le client **déchiffre le défi avec sa clé privée** et renvoie le plaintext via `POST /api/auth/register-confirm {pendingId, response}`.
4. Le serveur compare : si ça correspond, il **consomme** l'inscription (single-use) et délivre un **JWT HS256 (24 h)**. Sinon → 401 « proof of possession failed ».
   → Un attaquant ne peut plus enregistrer une clé publique qu'il ne possède pas (anti-usurpation).
   → Si le backend est injoignable, le client crée une identité **locale** (mode offline) et avertit l'utilisateur.

### Chiffrement des messages
- Par message : un **AES-GCM 256** aléatoire chiffre le corps ; la clé AES est **enveloppée (RSA-OAEP)** avec la clé publique du destinataire. Seul le destinataire (clé privée non-extractable) peut déchiffrer.
- **Fingerprint** : SHA-256 de la clé publique (base64), tronqué à **128 bits** (16 octets = 32 hex). C'est l'identifiant canonique utilisé pour les recherches (`/api/users/lookup`) et le safety number.
- **Safety number** (type Signal) : hash des deux fingerprints triés, rendu en 60 hex groupés par 4. À comparer **out-of-band** (appel, en personne) pour détecter un MITM / rotation de clé.
- **Key pinning** : la clé publique du contact est stockée à l'ajout et réutilisée pour chiffrer ; l'utilisateur peut marquer le contact « vérifié » après comparaison du safety number (badge vert + modale de vérification dans Contacts).

### Stockage & secrets (vérifié — conforme)
- **Token JWT** : en **mémoire uniquement** (`lib/api.ts`), jamais en localStorage.
- **Clé privée RSA** : **non-extractable**, handle CryptoKey dans **IndexedDB** (`lib/e2e.ts`). Même un XSS complet ne peut pas l'exfiltrer.
- **localStorage** ne contient que : identité **publique** (`crypt_identity`), état UI (`crypt_state` — les `plainContent` sont strippés à la sérialisation), réglages (`crypt_settings`). Aucun secret sensible.
- BDD backend : JSON, permissions **0600**, écriture atomique (tmp + fsync + rename).

### Sécurité réseau déjà en place (héritée)
- CORS strict via `ALLOWED_ORIGINS` (pas de wildcard), token en header (pas en query), rate-limiting par endpoint, validation du corps (1 MiB max), auth WS avec écrasement de l'identité côté serveur (anti-impersonation), IDOR corrigés (senderId/authorship côté serveur), membership de conversation vérifié.

---

## 2. Durcissements appliqués lors de cette session

| # | Domaine | Changement | Fichiers |
|---|---------|-----------|----------|
| 4 | Auth | Preuve de possession au register (défi RSA-OAEP déchiffré par le client) | `backend/internal/auth/auth.go`, `backend/cmd/server/main.go`, `frontend/lib/api.ts`, `frontend/components/AuthPage.tsx`, `frontend/lib/e2e.ts` |
| 4 | Auth | Rejet des doublons (clé publique / nom déjà pris → 409) | `backend/cmd/server/main.go` |
| 4 | Crypto | Fingerprint porté de **32 bits → 128 bits** (côté serveur ET client) | `backend/internal/auth/auth.go`, `frontend/lib/e2e.ts`, `frontend/components/AddContactModal.tsx` |
| 6 | Secrets | Vérifié : aucun secret en localStorage (token mémoire, clé privée IndexedDB non-extractable) | `frontend/lib/store.ts`, `frontend/lib/e2e.ts` |
| 7 | Crypto | Safety number (Signal-style) + modale de vérification + flag « vérifié » (key pinning) | `frontend/lib/e2e.ts`, `frontend/lib/types.ts`, `frontend/lib/store.ts`, `frontend/components/ContactVerifyModal.tsx`, `frontend/components/ContactsList.tsx` |
| 9 | Déps | `engines.node >= 18.18` ajouté ; `npm ci` + `npm audit` + `tsc` + `go build/vet` dans la CI | `frontend/package.json`, `.github/workflows/ci.yml` |
| 10 | Déploiement | Dockerfiles (backend Go, frontend Next), `docker-compose.yml`, CI GitHub Actions, `HOSTING.md` | voir section 3 |

**Validation effectuée** : `npx tsc --noEmit` (frontend) → OK ; `go build ./...` + `go vet ./...` (backend) → OK. Aucun build de prod lancé (conformément à la demande). Le handshake PoP et la modale de vérification sont donc **validés à la compilation mais pas en exécution** — à tester via un `npm run dev` + backend local avant mise en prod.

---

## 3. Hébergement

Artefacts créés (voir `HOSTING.md` pour le détail pas-à-pas) :
- `backend/Dockerfile` — multi-stage Go → alpine, `BIND=:9090`, volume `/data`.
- `frontend/Dockerfile` — multi-stage Node 18, build avec `NEXT_PUBLIC_API_URL` (ARG), servi via `npm start`.
- `docker-compose.yml` — `backend` + `frontend` sur un réseau commun.
- `.github/workflows/ci.yml` — CI frontend (npm ci, tsc, audit, build) + backend (go build, vet).

### Variables d'environnement (backend)
| Var | Requis | Défaut | Note |
|-----|--------|--------|------|
| `JWT_SECRET` | **OUI** | — | ≥ 32 octets. Sinon le serveur refuse de démarrer. |
| `BIND` | conteneur | `127.0.0.1:9090` | En conteneur → `:9090` (toutes interfaces). |
| `PORT` | non | `9090` | Utilisé seulement si `BIND` vide. |
| `DATA_DIR` | non | `./data` | **Persister** (volume). Contient le JSON de BDD. |
| `ALLOWED_ORIGINS` | oui (prod) | localhost:3000 | CSV, **pas de `*`**. Doit inclure l'URL du frontend. |

Frontend : `NEXT_PUBLIC_API_URL` (URL publique du backend, figée au **build**), `PORT` (3000).

### Options recommandées
1. **Render / Railway** : 2 services (web) — frontend (build `npm run build`, start `npm start`, var build `NEXT_PUBLIC_API_URL`) + backend Go (env `JWT_SECRET`, `BIND=:$PORT`, `ALLOWED_ORIGINS`). Le plus simple, TLS automatique.
2. **Fly.io** : `fly launch` avec les Dockerfiles ; `fly volumes` pour `/data` ; `fly secrets set JWT_SECRET=...`.
3. **VPS (Docker + nginx)** : `docker-compose up`, reverse proxy nginx avec **upgrade WebSocket** sur `/ws`, Certbot (TLS). Backup du volume `/data`.

### Gestion des secrets
- `JWT_SECRET` via le **secret manager** de la plateforme (Render/Railway secret, Fly secrets, ou fichier `.env` hors git sur VPS). **Jamais commité**.
- `DATA_DIR` sur stockage **persistant** (volume nommé / disque). ⚠️ La BDD est un fichier JSON mono-instance : pour une vraie prod multi-instances, prévoir une base (Postgres/SQLite + volume) — noté comme limitation.

### Limites connues (à planifier)
- Mono-instance (état en mémoire + JSON). Scaling horizontal nécessite une BDD + WS distribué.
- `output: 'standalone'` est activé dans `next.config.js` : l'image frontend pourrait être allégée en servant `.next/standalone/server.js` au lieu de `npm start` (à arbitrer).
- Le handshake PoP et le safety number sont neufs : tester avant prod.

---

## 4. Prochaines étapes suggérées
1. Tester en local (`docker-compose up` ou `npm run dev` + `go run ./cmd/server`) : créer 2 comptes, vérifier le safety number, envoyer un message chiffré.
2. Choisir l'hébergeur (Render/Railway recommandés pour démarrer) et fournir `JWT_SECRET` + `ALLOWED_ORIGINS`.
3. **Commit + push** (non fait ici, à ta demande) puis brancher la CI et le déploiement.
