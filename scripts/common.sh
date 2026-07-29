#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LLAMA_DIR="${LLAMA_DIR:-$PROJECT_ROOT/llama.cpp}"
BUILD_DIR="${BUILD_DIR:-$LLAMA_DIR/build-vulkan}"

if ! command -v brew >/dev/null 2>&1; then
  print -u2 "Homebrew is required: https://brew.sh"
  exit 1
fi

BREW_PREFIX="$(brew --prefix)"
MOLTENVK_PREFIX="$(brew --prefix molten-vk 2>/dev/null || true)"
VK_ICD_PATH="$MOLTENVK_PREFIX/etc/vulkan/icd.d/MoltenVK_icd.json"

export VK_ICD_FILENAMES="${VK_ICD_FILENAMES:-$VK_ICD_PATH}"
