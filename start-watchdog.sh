#!/usr/bin/env bash
# Watchdog auto-heal pour le frontend aetherlink (Android host).
# Sonde http://127.0.0.1:3000 toutes les 15s ; si le port est down,
# relance start-frontend.sh (qui force -H 127.0.0.1 pour éviter l'EACCES).
# Verrou (lockfile) pour qu'un seul watchdog tourne.
set -u
LOCK=/tmp/aetherlink-watchdog.lock
FRONTEND=/root/aetherlink/start-frontend.sh
URL=http://127.0.0.1:3000/

if [ -e "$LOCK" ]; then
  OLD=$(cat "$LOCK" 2>/dev/null || true)
  if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
    echo "watchdog déjà actif (pid $OLD)"
    exit 0
  fi
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

echo "watchdog démarré (pid $$) — surveillance $URL"
while true; do
  if ! curl -s -o /dev/null --max-time 4 "$URL"; then
    echo "$(date '+%H:%M:%S') frontend DOWN — relance"
    bash "$FRONTEND" >/tmp/aetherlink-frontend.log 2>&1 &
  fi
  sleep 15
done
