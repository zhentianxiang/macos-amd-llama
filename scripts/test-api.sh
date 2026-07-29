#!/bin/zsh
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8080}"

curl --silent --show-error \
  "$API_BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "local",
    "messages": [
      {
        "role": "user",
        "content": "/no_think 只回答：AMD显卡推理正常"
      }
    ],
    "max_tokens": 64,
    "temperature": 0
  }'
