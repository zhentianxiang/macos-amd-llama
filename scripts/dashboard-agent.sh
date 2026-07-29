#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

exec node "$PROJECT_ROOT/dashboard/agent/server.mjs"
