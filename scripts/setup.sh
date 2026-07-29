#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LLAMA_DIR="${LLAMA_DIR:-$PROJECT_ROOT/llama.cpp}"
LLAMA_REPOSITORY="${LLAMA_REPOSITORY:-https://github.com/ggml-org/llama.cpp.git}"
LLAMA_REF="${LLAMA_REF:-992c325323f925cb82c86778e5e91a63de199063}"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "x86_64" ]]; then
  print -u2 "This project targets Intel x86_64 macOS."
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  print -u2 "Install Homebrew first: https://brew.sh"
  exit 1
fi

brew install cmake molten-vk vulkan-loader vulkan-headers glslang shaderc

if [[ -d "$LLAMA_DIR/.git" ]]; then
  print "llama.cpp already exists at $LLAMA_DIR"
else
  git clone --filter=blob:none --no-checkout "$LLAMA_REPOSITORY" "$LLAMA_DIR"
  git -C "$LLAMA_DIR" fetch --depth 1 origin "$LLAMA_REF"
  git -C "$LLAMA_DIR" checkout --detach FETCH_HEAD
fi

"$PROJECT_ROOT/scripts/build.sh"
