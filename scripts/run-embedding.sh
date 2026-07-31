#!/bin/zsh
set -euo pipefail

source "$(dirname "$0")/common.sh"

MODEL_PATH="${EMBEDDING_MODEL_PATH:-$PROJECT_ROOT/models/gemma-4-12b-it-qat-q4_0.gguf}"
MMPROJ_PATH="${EMBEDDING_MMPROJ_PATH:-$PROJECT_ROOT/models/mmproj-gemma-4-12b-it-qat-q4_0.gguf}"
SERVER_HOST="${EMBEDDING_HOST:-127.0.0.1}"
SERVER_PORT="${EMBEDDING_PORT:-8092}"
CTX_SIZE="${EMBEDDING_CTX_SIZE:-4096}"
GPU_LAYERS="${EMBEDDING_GPU_LAYERS:-99}"

if [[ ! -x "$BUILD_DIR/bin/llama-server" ]]; then
  print -u2 "llama-server is missing. Run: make setup"
  exit 1
fi

if [[ ! -f "$MODEL_PATH" || ! -f "$MMPROJ_PATH" ]]; then
  print -u2 "Embedding model or vision projector is missing"
  exit 1
fi

exec "$BUILD_DIR/bin/llama-server" \
  --model "$MODEL_PATH" \
  --mmproj "$MMPROJ_PATH" \
  --embedding \
  --pooling mean \
  --embd-normalize 2 \
  --n-gpu-layers "$GPU_LAYERS" \
  --flash-attn off \
  --ctx-size "$CTX_SIZE" \
  --host "$SERVER_HOST" \
  --port "$SERVER_PORT"
