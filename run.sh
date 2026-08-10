#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${PORT:-9090}"
FRONTEND_PORT="${NEXT_PORT:-3000}"
JWT_SECRET="${JWT_SECRET:-}"

cleanup() {
  echo "Arret des services..."
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
  wait 2>/dev/null
  echo "Tout est arrete."
}
trap cleanup EXIT INT TERM

echo "+------------------------------------------+"
echo "|       CRYPTMessenger - Launch            |"
echo "+------------------------------------------+"

echo ""
echo "Compilation du backend Go..."
cd "$ROOT/backend"
go build -o cryptmessenger-server ./cmd/server/
echo "   OK ($(stat -c%s cryptmessenger-server 2>/dev/null || stat -f%z cryptmessenger-server 2>/dev/null) bytes)"

echo ""
echo "Demarrage du backend sur :$BACKEND_PORT..."
JWT_SECRET=$JWT_SECRET PORT=$BACKEND_PORT ./cryptmessenger-server &
BACKEND_PID=$!
sleep 1

if kill -0 "$BACKEND_PID" 2>/dev/null; then
  echo "   OK (PID $BACKEND_PID)"
else
  echo "   ECHEC"
  exit 1
fi

echo ""
echo "Installation des dependances..."
cd "$ROOT/frontend"
[ ! -d "node_modules" ] && npm install --no-audit --no-fund 2>&1 | tail -2

echo ""
echo "Demarrage du frontend sur :$FRONTEND_PORT..."
NEXT_PUBLIC_API_URL="http://localhost:$BACKEND_PORT" \
  npx next dev -p "$FRONTEND_PORT" &
FRONTEND_PID=$!

echo ""
echo "+------------------------------------------+"
echo "|                                          |"
echo "|   CRYPTMessenger est pret !              |"
echo "|                                          |"
echo "|   Frontend -> http://localhost:$FRONTEND_PORT"
echo "|   Backend  -> http://localhost:$BACKEND_PORT"
echo "|   Health   -> http://localhost:$BACKEND_PORT/health"
echo "|                                          |"
echo "|   Ctrl+C pour arreter                    |"
echo "|                                          |"
echo "+------------------------------------------+"

wait
