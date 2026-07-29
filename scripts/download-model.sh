#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="${MODEL_DIR:-$PROJECT_ROOT/models}"
MODEL_NAME="${MODEL_NAME:-Qwen3-8B-Q4_K_M.gguf}"
MODEL_URL="${MODEL_URL:-https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf}"
MODEL_PATH="$MODEL_DIR/$MODEL_NAME"

mkdir -p "$MODEL_DIR"

if [[ -f "$MODEL_PATH" ]]; then
  print "Model already exists: $MODEL_PATH"
  exit 0
fi

print "Downloading $MODEL_NAME"
curl --location \
  --fail \
  --retry 10 \
  --retry-all-errors \
  --continue-at - \
  --output "$MODEL_PATH" \
  "$MODEL_URL"

print "Saved: $MODEL_PATH"
