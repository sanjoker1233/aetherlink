# AetherLink (cryptmessenger)

Messagerie **chiffrée de bout en bout** avec conversations 1:1, **groupes
multi-participants**, **accusés de lecture**, messages éphémères et
**notifications push (WebPush)**. Le serveur ne voit jamais le contenu des
messages : tout le chiffrement se fait côté navigateur.

- **Frontend** : Next.js 14 (React 18, TypeScript, Tailwind) — `frontend/`
- **Backend**  : Go 1.22 — `backend/` (API REST + WebSocket, stockage JSON)
- **Déploiement** : Docker Compose (2 images : `backend`, `frontend`)

---

## Prérequis

| Outil  | Version minimale        |
|--------|-------------------------|
| Go     | 1.22                    |
| Node   | >= 18.18.0              |
| Docker | optionnel (pour le déploiement conteneurisé) |

---

## Démarrage rapide (sans Docker)

Deux terminaux sont nécessaires.

### 1. Backend

```bash
cd backend
export JWT_SECRET="$(openssl rand -base64 32)"   # >= 32 octets, OBLIGATOIRE
export ALLOWED_ORIGINS="http://localhost:3000"   # CORS : origine exacte du frontend
go run ./cmd/server
# Écoute 127.0.0.1:9090 par défaut (BIND/PORT overridables)
```

Le backend stocke ses données (utilisateurs, conversations, abonnements push)
dans `DATA_DIR` (défaut : répertoire courant). En dev local tu peux laisser la
valeur par défaut.

### 2. Frontend

```bash
cd frontend
npm install

# URL publique du backend, résolue PAR LE NAVIGATEUR (inline dans le bundle).
# En local : le backend tourne sur :9090.
export NEXT_PUBLIC_API_URL="http://localhost:9090"

npm run dev          # http://localhost:3000
```

Ouvre http://localhost:3000, crée deux comptes, ajoute un contact, et discute.
Le chiffrement (ECDH + AES-GCM) est négocié automatiquement entre pairs.

> Astuce CORS : `ALLOWED_ORIGINS` est une **liste CSV d'origines exactes** (pas
> de wildcard). Pour `http://localhost:3000` + un tunnel, sépare par des
> virgules : `http://localhost:3000,https://mon-tunnel.example.dev`.

---

## Déploiement (Docker Compose)

```bash
# 1. Crée un .env (NON committé) à la racine :
cat > .env <<'EOF'
JWT_SECRET=<32+ octets aléatoires, ex: openssl rand -base64 32>
ALLOWED_ORIGINS=https://ton-domaine.example
# URL résolue par le navigateur. En pratique : l'URL publique HTTPS du backend.
NEXT_PUBLIC_API_URL=https://api.ton-domaine.example
EOF

# 2. Build + run
docker compose up --build -d
```

- Backend : `https://ton-domaine.example` → conteneur `:9090` (volume
  `backend-data` persistant sur `/data`).
- Frontend : servi sur `:3000` (`next start`, image multi-stage).
- `NEXT_PUBLIC_API_URL` est **figé au build** dans le bundle frontend — il doit
  pointer vers l'URL publique que le navigateur peut atteindre, pas vers
  `http://backend:9090` sauf si le navigateur est lui-même dans le réseau Docker.

### Certificat TLS / HTTPS

Le HTTPS doit être terminé **devant** les conteneurs (reverse proxy type
Caddy / Nginx / Traefik). Le backend et le frontend n'exposent que du HTTP
dans Compose ; mets un proxy TLS en façade.

---

## Notifications push (WebPush / VAPID)

Les notifications push nécessitent un **contexte sécurisé (HTTPS)** et des clés
VAPID. Voir la documentation détaillée (génération des clés, flux
d'abonnement, confidentialité, limites) dans **`HOSTING.md`** (section
« Notifications push »).

En résumé :

```bash
# Clés VAPID stables (sinon clés éphémères en dev uniquement)
export VAPID_PUBLIC_KEY="<public key>"
export VAPID_PRIVATE_KEY="<private key>"
```

Le payload push ne contient **jamais** le corps du message (E2E préservé) :
il se contente de réveiller le client, qui va chercher le message chiffré.

---

## Variables d'environnement

| Variable              | Backend | Frontend | Description |
|-----------------------|:------:|:--------:|-------------|
| `JWT_SECRET`          |   ✔    |          | Secret JWT >= 32 octets (obligatoire). |
| `ALLOWED_ORIGINS`     |   ✔    |          | Origines CORS autorisées (CSV, pas de wildcard). |
| `BIND`                |   ✔    |          | Adresse d'écoute (défaut `127.0.0.1:9090` ; `:9090` en conteneur). |
| `PORT`                |   ✔    |          | Port d'écoute. |
| `DATA_DIR`            |   ✔    |          | Répertoire de stockage JSON (défaut `.`). |
| `VAPID_PUBLIC_KEY`    |   ✔    |          | Clé publique VAPID (optionnelle, éphémère sinon). |
| `VAPID_PRIVATE_KEY`   |   ✔    |          | Clé privée VAPID (optionnelle, éphémère sinon). |
| `NEXT_PUBLIC_API_URL` |        |   ✔      | URL publique du backend, inline au build. |

---

## Vérification / build

```bash
# Backend : compilation + tests
cd backend && go build ./... && go vet ./... && go test ./...

# Frontend : type-check + build de prod
cd frontend && npx tsc --noEmit && npm run build
```

---

## Notes de sécurité

- Le serveur stocke uniquement des **messages chiffrés** ; il ne peut pas en
  lire le contenu (E2E).
- `JWT_SECRET` doit provenir de l'environnement, jamais du code.
- Une seule instance backend est prévue (stockage JSON, état WebSocket
  stateful) — non adapté à un scaling horizontal sans adaptation.
- Les clés de prékey/identity restent côté client (IndexedDB), jamais envoyées
  au serveur en clair.

Voir `HOSTING.md` pour le guide de déploiement complet (push, CSP, TLS).
