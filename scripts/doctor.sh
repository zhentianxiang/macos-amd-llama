#!/bin/zsh
set -euo pipefail

source "$(dirname "$0")/common.sh"

print "System:"
sw_vers
print "Architecture: $(uname -m)"

print "\nDisplays:"
system_profiler SPDisplaysDataType |
  awk '/Chipset Model:|VRAM|Metal:/{sub(/^[[:space:]]+/, ""); print}'

for command_name in cmake glslc glslangValidator; do
  if command -v "$command_name" >/dev/null 2>&1; then
    print "$command_name: $(command -v "$command_name")"
  else
    print "$command_name: missing"
  fi
done

if [[ ! -f "$VK_ICD_FILENAMES" ]]; then
  print -u2 "\nMoltenVK ICD is missing: $VK_ICD_FILENAMES"
  exit 1
fi

if [[ ! -x "$BUILD_DIR/bin/llama-cli" ]]; then
  print -u2 "\nllama.cpp Vulkan build is missing. Run: make build"
  exit 1
fi

print "\nllama.cpp devices:"
"$BUILD_DIR/bin/llama-cli" --list-devices
