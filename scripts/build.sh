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

# macOS records the build directory in LC_RPATH. When a build directory is
# copied or moved to another path, @rpath lookups break even though all
# libraries sit next to the executables. Rewrite them relative to the binary.
BIN_DIR="$BUILD_DIR/bin"
find "$BIN_DIR" -maxdepth 1 -type f \
  \( -name 'llama-server' -o -name 'llama-cli' -o -name 'llama-bench' -o -name 'lib*.dylib' \) \
  -print0 | while IFS= read -r -d '' binary; do
  if otool -l "$binary" 2>/dev/null | grep -q "path $BIN_DIR (offset"; then
    install_name_tool -rpath "$BIN_DIR" "@loader_path" "$binary"
  fi
done
