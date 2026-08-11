# Guide d'hébergement — AetherLink

AetherLink = backend Go (API REST + WebSocket `/ws`) + frontend Next.js 14
(SPA client pur, aucune API route côté Next).

## 1. Variables d'environnement

### Backend (Go)

| Variable | Obligatoire | Défaut | Description |
|---|---|---|---|
| `JWT_SECRET` | **Oui** | — | Clé de signature JWT, **>= 32 octets**. Le serveur refuse de démarrer sans. À stocker dans le secret manager de la plateforme. |
| `BIND` | Oui en conteneur | `127.0.0.1:9090` | Adresse d'écoute. **En conteneur / PaaS : `BIND=:9090`**, sinon le service n'écoute que sur localhost et le health check échoue. |
| `PORT` | Non | `9090` | Port d'écoute. |
| `DATA_DIR` | Recommandé | `./data` | Dossier contenant le fichier JSON de base de données. **Doit pointer vers un volume persistant** (ex. `/data`). |
| `ALLOWED_ORIGINS` | Oui | — | Liste CSV d'origines exactes autorisées (CORS). **Pas de wildcard.** Doit contenir l'URL publique du frontend, ex. `https://app.example.com`. |

### Frontend (Next.js)

| Variable | Moment | Défaut | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | **AU BUILD** | `http://localhost:9090` | URL publique du backend, telle que vue **par le navigateur**. Inline dans le bundle : changer la valeur impose un **rebuild**. Elle alimente aussi la CSP `connect-src` (http + ws) dans `next.config.js`. |
| `PORT` | Runtime | `3000` | Port de `next start`. |
| `HOSTNAME` | Runtime (conteneur) | — | Mettre `0.0.0.0`. |

Règles d'or :
- `BIND=:9090` côté backend dès qu'on est en conteneur/PaaS.
- `ALLOWED_ORIGINS` doit inclure l'origine exacte du frontend (schéma + host + port éventuel), sans wildcard. Ex. : `https://app.example.com,https://www.example.com`.
- `NEXT_PUBLIC_API_URL` doit être une URL **publiquement joignable** (pas `http://backend:9090`, sauf en tout-local Docker avec navigateur dans le même réseau). En HTTPS, le WebSocket bascule automatiquement en `wss://`.

### Secrets
- Ne **jamais** committer `JWT_SECRET` (ni `.env`). Utiliser le secret manager de la plateforme (Render Environment/Secret Files, Railway Variables, `fly secrets set`, fichier `.env` non versionné + `chmod 600` sur VPS).
- Génération : `openssl rand -base64 48`.
- Rotation de `JWT_SECRET` = invalidation de tous les tokens existants (reconnexion des utilisateurs).

## 2. Limite importante : persistance

La « base de données » est un **fichier JSON** dans `DATA_DIR`. Conséquences :
- Toute plateforme **stateless** (filesystem éphémère : Render free, Railway sans volume, Fly sans volume) **perd les données à chaque redéploiement/redémarrage**.
- Il faut donc **monter un volume persistant** sur `DATA_DIR` (`/data`).
- Le stockage JSON n'est **pas concurrent-safe entre instances** : exécuter **une seule instance** du backend (pas d'autoscaling horizontal, pas de rolling deploy multi-instance).
- Pour une vraie prod : migrer vers PostgreSQL/SQLite+Litestream. Le JSON convient au prototype / petit déploiement mono-instance.

## 3. Render

### Option A — deux Web Services natifs

Backend (Environment: Go) :
- Root directory : `backend`
- Build command : `go build -o server ./cmd/server`
- Start command : `./server`
- Env vars : `JWT_SECRET` (secret), `BIND=:9090`, `PORT=9090`, `DATA_DIR=/data`, `ALLOWED_ORIGINS=https://<frontend>.onrender.com`
- Ajouter un **Disk** monté sur `/data` (sinon perte de données).
- Note : Render injecte son propre `PORT`; garder `BIND=:9090` cohérent avec `PORT=9090`, ou aligner `BIND` sur le port fourni.

Frontend (Environment: Node) :
- Root directory : `frontend`
- Build command : `npm ci && npm run build`
- Start command : `npm start`
- Env vars : `NEXT_PUBLIC_API_URL=https://<backend>.onrender.com` (présente **au build**), `PORT=3000` (ou laisser Render l'injecter).
- Après tout changement d'URL backend : **Clear build cache & deploy**.

### Option B — Docker
Utiliser les `Dockerfile` fournis (`dockerfilePath: backend/Dockerfile`, contexte `backend`, idem frontend). Pour le frontend, passer `NEXT_PUBLIC_API_URL` en **build arg** (Docker Build Args dans les settings Render).

## 4. Railway

Deux services depuis le même repo :

Backend :
- Root directory `backend`, builder Dockerfile (recommandé) ou Nixpacks.
- Variables : `JWT_SECRET` (secret), `BIND=:9090`, `PORT=9090`, `DATA_DIR=/data`, `ALLOWED_ORIGINS=https://<frontend>.up.railway.app`.
- Attacher un **Volume** monté sur `/data`.
- Générer un domaine public → c'est l'URL à donner au frontend.

Frontend :
- Root directory `frontend`.
- Build : `npm ci && npm run build`, Start : `npm start`.
- Variable `NEXT_PUBLIC_API_URL=https://<backend>.up.railway.app` définie **avant le build** (Railway rebuild à chaque changement de variable — vérifier que le build a bien été relancé).
- Ne pas utiliser l'URL interne `*.railway.internal` : le navigateur ne peut pas la résoudre.

## 5. Fly.io

Deux apps distinctes, chacune avec son Dockerfile.

`backend/fly.toml` :

```toml
app = "aetherlink-backend"
primary_region = "cdg"

[build]
  dockerfile = "Dockerfile"

[env]
  BIND = ":9090"
  PORT = "9090"
  DATA_DIR = "/data"
  ALLOWED_ORIGINS = "https://aetherlink-frontend.fly.dev"

[[mounts]]
  source = "aetherlink_data"
  destination = "/data"

[http_service]
  internal_port = 9090
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
```

```bash
fly volumes create aetherlink_data --size 1 -a aetherlink-backend
fly secrets set JWT_SECRET="$(openssl rand -base64 48)" -a aetherlink-backend
fly deploy -c backend/fly.toml
```

`frontend/fly.toml` :

```toml
app = "aetherlink-frontend"
primary_region = "cdg"

[build]
  dockerfile = "Dockerfile"
  [build.args]
    NEXT_PUBLIC_API_URL = "https://aetherlink-backend.fly.dev"

[env]
  PORT = "3000"
  HOSTNAME = "0.0.0.0"

[http_service]
  internal_port = 3000
  force_https = true
```

```bash
fly deploy -c frontend/fly.toml --build-arg NEXT_PUBLIC_API_URL=https://aetherlink-backend.fly.dev
```

Garder `min_machines_running = 1` et **une seule machine** backend (fichier JSON, WebSocket sticky).

## 6. VPS (docker-compose + nginx + TLS)

À la racine du repo, créer un `.env` **non versionné** :

```bash
JWT_SECRET=<openssl rand -base64 48>
ALLOWED_ORIGINS=https://app.example.com
NEXT_PUBLIC_API_URL=https://api.example.com
```

Puis :

```bash
docker compose build
docker compose up -d
```

Le backend écoute sur `127.0.0.1:9090` côté hôte (via le mapping), le frontend sur `:3000`. On place nginx devant.

```nginx
# /etc/nginx/sites-available/aetherlink
server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate     /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:9090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

server {
    listen 80;
    server_name app.example.com api.example.com;
    return 301 https://$host$request_uri;
}
```

TLS : `certbot --nginx -d app.example.com -d api.example.com` (renouvellement auto via timer systemd).

Durcissement :
- Firewall : n'exposer que 80/443 ; retirer les `ports:` du compose et passer par le réseau Docker + nginx si nginx est conteneurisé.
- Sauvegarder régulièrement le volume `backend-data` (`docker run --rm -v aetherlink_backend-data:/data -v $PWD:/b alpine tar czf /b/backup.tgz /data`).

## 7. Checklist de mise en ligne

1. `JWT_SECRET` généré (>= 32 octets) et stocké en secret, jamais committé.
2. `BIND=:9090` sur le backend.
3. `ALLOWED_ORIGINS` = URL(s) exacte(s) du frontend, sans wildcard.
4. `NEXT_PUBLIC_API_URL` = URL publique HTTPS du backend, définie **au build** (rebuild après changement).
5. Volume persistant monté sur `DATA_DIR` (`/data`).
6. Une seule instance backend (stockage JSON + WebSocket).
7. HTTPS partout : sinon le WebSocket `wss://` et la CSP échoueront depuis une page HTTPS.
