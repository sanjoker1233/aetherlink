#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${PORT:-9090}"
FRONTEND_PORT="${NEXT_PORT:-3000}"
JWT_SECRET="${JWT_SECRET:-}"

cleanup() {
  echo "Stopping services..."
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
  wait 2>/dev/null
  echo "Everything is stopped."
}
trap cleanup EXIT INT TERM

echo "+------------------------------------------+"
echo "|       CRYPTMessenger - Launch            |"
echo "+------------------------------------------+"

echo ""
echo "Compiling Go backend..."
cd "$ROOT/backend"
go build -o cryptmessenger-server ./cmd/server/
echo "   OK ($(stat -c%s cryptmessenger-server 2>/dev/null || stat -f%z cryptmessenger-server 2>/dev/null) bytes)"

echo ""
echo "Starting backend on :$BACKEND_PORT..."
JWT_SECRET=$JWT_SECRET PORT=$BACKEND_PORT BIND="${BIND:-:9090}" ./cryptmessenger-server &
BACKEND_PID=$!
sleep 1

if kill -0 "$BACKEND_PID" 2>/dev/null; then
  echo "   OK (PID $BACKEND_PID)"
else
  echo "   FAILED"
  exit 1
fi

echo ""
echo "Installing dependencies..."
cd "$ROOT/frontend"
[ ! -d "node_modules" ] && npm install --no-audit --no-fund 2>&1 | tail -2

echo ""
echo "Starting frontend on :$FRONTEND_PORT..."
NEXT_PUBLIC_API_URL="http://localhost:$BACKEND_PORT" \
  npx next dev -p "$FRONTEND_PORT" &
FRONTEND_PID=$!

echo ""
echo "+------------------------------------------+"
echo "|                                          |"
echo "|   CRYPTMessenger is ready!              |"
echo "|                                          |"
echo "|   Frontend -> http://localhost:$FRONTEND_PORT"
echo "|   Backend  -> http://localhost:$BACKEND_PORT"
echo "|   Health   -> http://localhost:$BACKEND_PORT/health"
echo "|                                          |"
echo "|   Ctrl+C to stop                    |"
echo "|                                          |"
echo "+------------------------------------------+"

wait
