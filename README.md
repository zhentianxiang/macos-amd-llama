# macos-amd-llama

Run `llama.cpp` with an AMD discrete GPU on an Intel (`x86_64`) macOS host
through Vulkan and MoltenVK.

在 Intel 黑苹果/macOS 宿主机上，通过 Vulkan + MoltenVK 调用 AMD 独立显卡运行
本地大语言模型，并提供 OpenAI 兼容 API。

## Why this project exists / 项目背景

Docker Desktop for macOS does not expose the host AMD GPU to its Linux VM.
Native Metal currently produces incorrect model output on some Intel Mac +
AMD discrete GPU configurations even though benchmark numbers look normal.

This project uses the verified path:

```text
llama.cpp -> Vulkan -> MoltenVK -> AMD Radeon GPU
```

The current reference machine is:

- Intel `x86_64`
- macOS 15.7.2
- AMD Radeon RX 6700 XT 12 GB
- 32 GB system memory

This is a community deployment recipe, not an Apple, AMD, or llama.cpp
compatibility guarantee.

## Features / 功能

- Detects the AMD GPU exposed by MoltenVK
- Builds upstream `llama.cpp` with Vulkan enabled and Metal disabled
- Pins the verified upstream commit for reproducible builds
- Downloads a recommended GGUF model with resume support
- Offloads model layers to the AMD GPU
- Starts an OpenAI-compatible API on localhost
- Includes hardware diagnostics and an API smoke test
- Keeps models, upstream source, and build products out of Git
- Includes a local Web console for hardware metrics and model management

## Web console / Web 控制台

首次安装前端依赖：

```bash
make dashboard-install
```

打开两个终端，分别运行：

```bash
make dashboard-agent
make dashboard-web
```

访问 <http://localhost:3000>。控制台实时显示 CPU、系统内存、GPU 活动率、显存、
温度、功耗和推理速度，并支持下载、启动与切换 GGUF 模型。

控制代理仅监听 `127.0.0.1:8090`，llama-server 仅监听 `127.0.0.1:8080`。
如果 8080 已存在手工启动的 llama-server，面板会显示其在线状态，但不会停止或
替换该外部进程，以避免误杀其他服务。

## Requirements / 环境要求

- Intel Mac or Hackintosh: `uname -m` must report `x86_64`
- A macOS-supported AMD GPU with Metal support
- macOS Command Line Tools
- [Homebrew](https://brew.sh/)
- At least 12 GB free disk space for the default model and build files

Verify the GPU first:

```bash
system_profiler SPDisplaysDataType
```

The output should contain the AMD GPU and `Metal: Supported`.

## Quick start / 快速开始

```bash
git clone https://github.com/YOUR_ACCOUNT/macos-amd-llama.git
cd macos-amd-llama

make setup
make doctor
make download
make run
```

The first Vulkan build can take several minutes on an Intel CPU.
By default, setup checks out the verified llama.cpp commit
`992c325323f925cb82c86778e5e91a63de199063`. Advanced users can override it
with `LLAMA_REF`.

Open another terminal and test the API:

```bash
make test
```

Expected API address:

```text
http://127.0.0.1:8080/v1
```

## Default model / 默认模型

The download script selects:

```text
Qwen3-8B-Q4_K_M.gguf
```

This model is about 5 GB and is a good match for a 12 GB GPU. It supports
Chinese and English conversation and is published under Apache 2.0.

Download it with:

```bash
make download
```

To download a different GGUF file:

```bash
MODEL_NAME="model.gguf" \
MODEL_URL="https://example.com/model.gguf" \
./scripts/download-model.sh
```

## Configuration / 配置

Environment variables accepted by `scripts/run.sh`:

| Variable | Default | Description |
| --- | --- | --- |
| `MODEL_PATH` | `models/Qwen3-8B-Q4_K_M.gguf` | Absolute or project-relative model path |
| `LLAMA_HOST` | `127.0.0.1` | Listen address |
| `LLAMA_PORT` | `8080` | HTTP port |
| `CTX_SIZE` | `8192` | Context size |
| `GPU_LAYERS` | `99` | Layers requested for GPU offload |

Example:

```bash
MODEL_PATH="$PWD/models/another-model.gguf" \
CTX_SIZE=4096 \
LLAMA_PORT=8081 \
make run
```

Keep the default `127.0.0.1` unless remote access is intentionally required.
The server has no API key by default.

## OpenAI-compatible request / API 调用

```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "local",
    "messages": [
      {"role": "user", "content": "/no_think 你好，请介绍一下自己"}
    ]
  }'
```

Python:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="local",
)

result = client.chat.completions.create(
    model="local",
    messages=[{"role": "user", "content": "/no_think 你好"}],
)

print(result.choices[0].message.content)
```

## Verify GPU use / 验证显卡

```bash
make doctor
```

Expected device output:

```text
Vulkan0: AMD Radeon RX 6700 XT
```

Benchmark a downloaded model:

```bash
VK_ICD_FILENAMES="$(brew --prefix molten-vk)/etc/vulkan/icd.d/MoltenVK_icd.json" \
./llama.cpp/build-vulkan/bin/llama-bench \
  -m ./models/Qwen3-8B-Q4_K_M.gguf \
  -ngl 99 \
  -fa 0
```

## Why not Docker Compose? / 为什么不用 Docker Compose？

Docker Desktop on macOS runs Linux containers in a Linux VM. The VM does not
receive the macOS Metal device and does not expose `/dev/dri` or `/dev/kfd`.
A container image may run on the CPU, but it cannot reproduce this host GPU
path.

On a native Linux host, AMD GPU containers are possible by passing
`/dev/dri` and, for ROCm, `/dev/kfd`. That is a different deployment target.

## Troubleshooting / 故障排查

### Device list is empty

Run:

```bash
make doctor
```

Confirm that `molten-vk` is installed and its ICD JSON exists.

### Native Metal output is random or contains repeated symbols

Do not switch this build to `GGML_METAL=ON`. AMD discrete GPUs on Intel macOS
can produce plausible benchmark results while returning incorrect tokens.
Use the Vulkan build supplied by this project.

### Out of memory

Reduce context size:

```bash
CTX_SIZE=4096 make run
```

Or use a smaller `Q4_K_M` GGUF model.

### The server is visible on the LAN

Do not reuse the system `HOST` variable. This project intentionally uses
`LLAMA_HOST`, which defaults to `127.0.0.1`.

## Upstream projects

- [llama.cpp](https://github.com/ggml-org/llama.cpp)
- [MoltenVK](https://github.com/KhronosGroup/MoltenVK)
- [Qwen3-8B-GGUF](https://huggingface.co/Qwen/Qwen3-8B-GGUF)
