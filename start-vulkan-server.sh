#!/bin/zsh
set -euo pipefail

exec "$(cd "$(dirname "$0")" && pwd)/scripts/run.sh"
