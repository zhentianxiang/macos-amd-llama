#!/bin/zsh
set -euo pipefail

source "$(dirname "$0")/common.sh"

if [[ ! -d "$LLAMA_DIR" ]]; then
  print -u2 "llama.cpp is missing. Run: make setup"
  exit 1
fi

# Apple Clang can spend a very long time optimizing the generated Vulkan
# translation unit at -O3 on Intel Macs. -O1 keeps setup practical; GPU
# kernels are still compiled separately by glslc.
cmake -S "$LLAMA_DIR" -B "$BUILD_DIR" \
  -DGGML_VULKAN=ON \
  -DGGML_METAL=OFF \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="$BREW_PREFIX" \
  -DCMAKE_C_FLAGS_RELEASE="-O1 -DNDEBUG" \
  -DCMAKE_CXX_FLAGS_RELEASE="-O1 -DNDEBUG"

cmake --build "$BUILD_DIR" \
  --config Release \
  --parallel "${BUILD_JOBS:-6}" \
  --target llama-cli llama-server llama-bench
