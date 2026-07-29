#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

export NEXT_PUBLIC_AGENT_PORT="${DASHBOARD_AGENT_PORT:-8090}"

cd "$PROJECT_ROOT/dashboard"
exec npm run dev -- \
  --host "${DASHBOARD_WEB_HOST:-127.0.0.1}" \
  --port "${DASHBOARD_WEB_PORT:-3000}"
