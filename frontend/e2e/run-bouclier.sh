#!/usr/bin/env bash
# Bouclier de validation E2E (aetherlink).
#
# Orchestre les suites Playwright contre un frontend de PROD (next start) et un
# backend Go relancé FRAIS avant chaque suite (reset du rate-limiter).
#
# PRÉREQUIS :
#   - frontend de prod déjà lancé sur :3000 (ex: bash start-frontend.sh)
#   - binaire backend buildé dans backend/ (sinon ce script le build)
#   - backend/.jwt.env présent (secret JWT)
#
# La suite ui-e2e-serverdown.mjs tourne AVEC le backend VOLONTAIREMENT ÉTEINT
# (on le tue juste avant) pour prouver le blocage côté serveur (ServerGuard).
set -u
cd /root/aetherlink/backend
set -a; . ./.jwt.env; set +a

DATA_DIR=/tmp/aetherlink-e2e-data
ALLOWED_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
BIN=/root/aetherlink/backend/cryptmessenger-server
FE=http://localhost:3000
API=http://127.0.0.1:9090
SUITES="ui-e2e-i18n.mjs ui-e2e-group.mjs ui-e2e.mjs ui-e2e-push.mjs ui-e2e-decline.mjs ui-e2e-ephemeral.mjs ui-e2e-serverdown.mjs"

# Build the backend if the binary is missing.
if [ ! -x "$BIN" ]; then
  echo "== building backend =="
  go build -o cryptmessenger-server ./cmd/server/ || { echo "BACKEND BUILD FAILED"; exit 1; }
fi

start_backend() {
  pkill -f 'cryptmessenger-server' 2>/dev/null || true
  sleep 1
  rm -rf "$DATA_DIR"
  mkdir -p "$DATA_DIR"
  PORT=9090 DATA_DIR="$DATA_DIR" ALLOWED_ORIGINS="$ALLOWED_ORIGINS" "$BIN" >/tmp/be.log 2>&1 &
  local pid=$!
  local i=0
  while [ $i -lt 40 ]; do
    if curl -s -o /dev/null --max-time 2 "$API/health"; then echo "  backend up (pid $pid)"; return 0; fi
    sleep 0.5; i=$((i+1))
  done
  echo "  BACKEND FAILED TO START"; tail -20 /tmp/be.log; return 1
}

overall=0
for s in $SUITES; do
  echo "=== SUITE: $s ==="
  if [ "$s" = "ui-e2e-serverdown.mjs" ]; then
    # Server-down suite: backend MUST be off so the gate blocks.
    pkill -f 'cryptmessenger-server' 2>/dev/null || true
    sleep 1
    echo "  backend forced DOWN for server-down gate test"
    pushd /root/aetherlink/frontend >/dev/null
    E2E_BASE="$FE" E2E_API="$API" E2E_VIEWPORT="1280x900" node "e2e/$s"
    rc=$?
    popd >/dev/null
    if [ $rc -eq 0 ]; then echo "  >> $s PASS"; else echo "  >> $s FAIL (rc=$rc)"; overall=1; fi
    continue
  fi
  start_backend || { overall=1; continue; }
  pushd /root/aetherlink/frontend >/dev/null
  E2E_BASE="$FE" E2E_API="$API" E2E_VIEWPORT="1280x900" node "e2e/$s"
  rc=$?
  popd >/dev/null
  if [ $rc -eq 0 ]; then echo "  >> $s PASS"; else echo "  >> $s FAIL (rc=$rc)"; overall=1; fi
  pkill -f 'cryptmessenger-server' 2>/dev/null || true
  sleep 1
done

echo "========================================="
if [ $overall -eq 0 ]; then echo "BOUCLIER OVERALL: GREEN"; else echo "BOUCLIER OVERALL: RED"; fi
exit $overall
