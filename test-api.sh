#!/bin/zsh
set -euo pipefail

exec "$(cd "$(dirname "$0")" && pwd)/scripts/test-api.sh"
