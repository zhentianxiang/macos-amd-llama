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
EMBEDDING_PORT="${EMBEDDING_PORT:-8092}"
AGENT_URL="http://$AGENT_HOST:$AGENT_PORT"

MODEL_PATH="${MODEL_PATH:-$PROJECT_ROOT/models/Qwen3-8B-Q4_K_M.gguf}"
DEFAULT_MODEL="${MODEL_PATH##*/}"
EMBEDDING_MODEL_PATH="${EMBEDDING_MODEL_PATH:-$PROJECT_ROOT/models/gemma-4-12b-it-qat-q4_0.gguf}"
EMBEDDING_MMPROJ_PATH="${EMBEDDING_MMPROJ_PATH:-$PROJECT_ROOT/models/mmproj-gemma-4-12b-it-qat-q4_0.gguf}"
BUILD_DIR="${BUILD_DIR:-$PROJECT_ROOT/llama.cpp/build-vulkan}"
LLAMA_SERVER="$BUILD_DIR/bin/llama-server"

typeset -i EMBEDDING_PID=0
typeset -i AGENT_PID=0
typeset -i WEB_PID=0

cleanup() {
  trap - EXIT INT TERM HUP

  if (( EMBEDDING_PID > 0 )) && kill -0 "$EMBEDDING_PID" 2>/dev/null; then
    kill -TERM "$EMBEDDING_PID" 2>/dev/null || true
  fi
  if (( AGENT_PID > 0 )) && kill -0 "$AGENT_PID" 2>/dev/null; then
    kill -TERM "$AGENT_PID" 2>/dev/null || true
  fi
  if (( WEB_PID > 0 )) && kill -0 "$WEB_PID" 2>/dev/null; then
    kill -TERM "$WEB_PID" 2>/dev/null || true
  fi

  (( EMBEDDING_PID > 0 )) && wait "$EMBEDDING_PID" 2>/dev/null || true
  (( AGENT_PID > 0 )) && wait "$AGENT_PID" 2>/dev/null || true
  (( WEB_PID > 0 )) && wait "$WEB_PID" 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 130' INT TERM HUP

port_open() {
  local port="$1"
  nc -z -w 1 127.0.0.1 "$port" >/dev/null 2>&1
}

cd "$DASHBOARD_DIR"

print "Building dashboard..."
npm run build

if [[ -x "$LLAMA_SERVER" ]]; then
  if [[ -f "$MODEL_PATH" ]]; then
    print "llama-server 将通过面板自动加载: $DEFAULT_MODEL"
  else
    print -u2 "默认模型不存在: $MODEL_PATH"
    print -u2 "跳过自动加载，面板启动后可手动加载，或运行: make download"
  fi
else
  print -u2 "llama-server 不存在: $LLAMA_SERVER"
  print -u2 "跳过 8080 自动启动，请先运行: make setup"
fi

if [[ -x "$LLAMA_SERVER" && -f "$EMBEDDING_MODEL_PATH" && -f "$EMBEDDING_MMPROJ_PATH" ]]; then
  if port_open "$EMBEDDING_PORT"; then
    print "端口 $EMBEDDING_PORT 已有图片向量服务，跳过启动。"
  else
    print "Starting embedding service on 127.0.0.1:$EMBEDDING_PORT..."
    "$PROJECT_ROOT/scripts/run-embedding.sh" &
    EMBEDDING_PID=$!
  fi
else
  print -u2 "图片向量模型或视觉投影缺失，跳过 8092 服务:"
  print -u2 "  $EMBEDDING_MODEL_PATH"
  print -u2 "  $EMBEDDING_MMPROJ_PATH"
fi

print "Starting dashboard agent on $AGENT_HOST:$AGENT_PORT..."
node "$DASHBOARD_DIR/agent/server.mjs" &
AGENT_PID=$!

print "Starting dashboard web on $WEB_HOST:$WEB_PORT..."
"$DASHBOARD_DIR/node_modules/.bin/vinext" start --hostname "$WEB_HOST" --port "$WEB_PORT" &
WEB_PID=$!

print "Dashboard:   http://$WEB_HOST:$WEB_PORT"
print "llama API:   http://127.0.0.1:${LLAMA_PORT:-8080}/v1"
print "embedding:   http://127.0.0.1:$EMBEDDING_PORT/embeddings"
print "Press Ctrl+C to stop all services."

if [[ -x "$LLAMA_SERVER" && -f "$MODEL_PATH" ]]; then
  agent_ready=false
  for _ in {1..60}; do
    if curl --silent --output /dev/null --max-time 1 "$AGENT_URL/api/status"; then
      agent_ready=true
      break
    fi
    sleep 0.5
  done

  if [[ "$agent_ready" == true ]]; then
    start_response="$(curl --silent --show-error --max-time 10 \
      --header "Content-Type: application/json" \
      --data "{\"model\":\"$DEFAULT_MODEL\"}" \
      "$AGENT_URL/api/server/start" 2>/dev/null || true)"
    if [[ "$start_response" == *'"error"'* ]]; then
      if [[ "$start_response" == *"外部"* ]]; then
        print "检测到外部 llama-server 已运行在 ${LLAMA_PORT:-8080}，面板将直接使用它。"
      else
        print -u2 "自动加载模型失败（面板仍可手动加载）: $start_response"
      fi
    elif [[ -n "$start_response" ]]; then
      print "模型正在加载: $DEFAULT_MODEL"
    fi
  else
    print -u2 "控制代理未就绪，跳过自动加载模型。"
  fi
fi

while true; do
  if (( EMBEDDING_PID > 0 )) && ! kill -0 "$EMBEDDING_PID" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$AGENT_PID" 2>/dev/null || ! kill -0 "$WEB_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if (( EMBEDDING_PID > 0 )) && ! kill -0 "$EMBEDDING_PID" 2>/dev/null; then
  if wait "$EMBEDDING_PID"; then
    exit_code=0
  else
    exit_code=$?
  fi
  print -u2 "图片向量服务已停止。"
elif ! kill -0 "$AGENT_PID" 2>/dev/null; then
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
