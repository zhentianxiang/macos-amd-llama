#!/bin/zsh
set -euo pipefail

source "$(dirname "$0")/common.sh"

MODEL_PATH="${MODEL_PATH:-$PROJECT_ROOT/models/Qwen3-8B-Q4_K_M.gguf}"
if [[ -z "${MODEL_ALIAS:-}" ]]; then
  MODEL_ALIAS="${MODEL_PATH##*/}"
  MODEL_ALIAS="${MODEL_ALIAS%.gguf}"
fi
SERVER_HOST="${LLAMA_HOST:-127.0.0.1}"
SERVER_PORT="${LLAMA_PORT:-8080}"
CTX_SIZE="${CTX_SIZE:-16384}"
GPU_LAYERS="${GPU_LAYERS:-99}"
MMPROJ_PATH="${MMPROJ_PATH:-}"
ENABLE_EMBEDDING="${ENABLE_EMBEDDING:-1}"

if [[ ! -x "$BUILD_DIR/bin/llama-server" ]]; then
  print -u2 "llama-server is missing. Run: make setup"
  exit 1
fi

if [[ ! -f "$MODEL_PATH" ]]; then
  print -u2 "Model is missing: $MODEL_PATH"
  print -u2 "Run: make download"
  exit 1
fi

EXTRA_ARGS=()
if [[ -n "$MMPROJ_PATH" ]]; then
  if [[ ! -f "$MMPROJ_PATH" ]]; then
    print -u2 "Vision projector is missing: $MMPROJ_PATH"
    exit 1
  fi
  EXTRA_ARGS+=(--mmproj "$MMPROJ_PATH")
fi
if [[ "$ENABLE_EMBEDDING" == "1" ]]; then
  EXTRA_ARGS+=(--embedding --pooling mean --embd-normalize 2)
fi
EXTRA_ARGS+=(--alias "$MODEL_ALIAS")

exec "$BUILD_DIR/bin/llama-server" \
  --model "$MODEL_PATH" \
  "${EXTRA_ARGS[@]}" \
  --n-gpu-layers "$GPU_LAYERS" \
  --flash-attn off \
  --ctx-size "$CTX_SIZE" \
  --metrics \
  --host "$SERVER_HOST" \
  --port "$SERVER_PORT"
