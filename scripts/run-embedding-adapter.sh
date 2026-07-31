#!/bin/zsh
set -euo pipefail
source "$(dirname "$0")/common.sh"
exec node "$PROJECT_ROOT/scripts/embedding-adapter.mjs"
