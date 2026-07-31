#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DASHBOARD_DIR="$PROJECT_ROOT/dashboard"

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  print -u2 "Node.js and npm are required (Node.js >= 22.13.0)."
  exit 1
fi

if [[ ! -d "$DASHBOARD_DIR/node_modules" ]]; then
  print -u2 "Dashboard dependencies are missing. Run: make dashboard-install"
  exit 1
fi

export NEXT_PUBLIC_AGENT_PORT="${DASHBOARD_AGENT_PORT:-8090}"

AGENT_HOST="${DASHBOARD_AGENT_HOST:-127.0.0.1}"
AGENT_PORT="${DASHBOARD_AGENT_PORT:-8090}"
WEB_HOST="${DASHBOARD_WEB_HOST:-127.0.0.1}"
WEB_PORT="${DASHBOARD_WEB_PORT:-3000}"

typeset -i AGENT_PID=0
typeset -i WEB_PID=0

cleanup() {
  trap - EXIT INT TERM HUP

  if (( AGENT_PID > 0 )) && kill -0 "$AGENT_PID" 2>/dev/null; then
    kill -TERM "$AGENT_PID" 2>/dev/null || true
  fi
  if (( WEB_PID > 0 )) && kill -0 "$WEB_PID" 2>/dev/null; then
    kill -TERM "$WEB_PID" 2>/dev/null || true
  fi

  (( AGENT_PID > 0 )) && wait "$AGENT_PID" 2>/dev/null || true
  (( WEB_PID > 0 )) && wait "$WEB_PID" 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 130' INT TERM HUP

cd "$DASHBOARD_DIR"

print "Building dashboard..."
npm run build

print "Starting dashboard agent on $AGENT_HOST:$AGENT_PORT..."
node "$DASHBOARD_DIR/agent/server.mjs" &
AGENT_PID=$!

print "Starting dashboard web on $WEB_HOST:$WEB_PORT..."
"$DASHBOARD_DIR/node_modules/.bin/vinext" start --hostname "$WEB_HOST" --port "$WEB_PORT" &
WEB_PID=$!

print "Dashboard: http://$WEB_HOST:$WEB_PORT"
print "在页面中选择模型后，llama-server 才会启动（默认 127.0.0.1:8080）。"
print "Press Ctrl+C to stop both services."

while kill -0 "$AGENT_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$AGENT_PID" 2>/dev/null; then
  if wait "$AGENT_PID"; then
    exit_code=0
  else
    exit_code=$?
  fi
  print -u2 "Dashboard agent stopped."
else
  if wait "$WEB_PID"; then
    exit_code=0
  else
    exit_code=$?
  fi
  print -u2 "Dashboard web stopped."
fi

exit "$exit_code"
