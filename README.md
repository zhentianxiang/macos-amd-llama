# macos-amd-llama

在 Intel（`x86_64`）黑苹果或 macOS 主机上，通过 Vulkan 与 MoltenVK 调用
AMD 独立显卡运行 `llama.cpp`，并提供 OpenAI 兼容 API 和本地 Web 控制台。

## 项目背景

Docker Desktop for macOS 运行在 Linux 虚拟机中，无法把宿主机的 AMD GPU
直接提供给容器。另一方面，在部分 Intel Mac 与 AMD 独立显卡组合上，
原生 Metal 后端虽然跑分看似正常，但模型可能输出错误内容。

本项目采用已经在参考设备上验证通过的调用链：

```text
llama.cpp -> Vulkan -> MoltenVK -> AMD Radeon GPU
```

参考设备配置：

- Intel `x86_64`
- macOS 15.7.2
- AMD Radeon RX 6700 XT 12 GB
- 32 GB 系统内存

本项目是社区部署方案，不代表 Apple、AMD 或 llama.cpp 官方兼容性保证。

## 功能

- 检测 MoltenVK 提供的 AMD GPU
- 启用 Vulkan、禁用 Metal 并编译上游 `llama.cpp`
- 固定已验证的上游版本，便于复现
- 下载推荐的 GGUF 模型，支持断点续传
- 将模型层卸载到 AMD GPU
- 在本机启动 OpenAI 兼容 API
- 提供硬件诊断和 API 冒烟测试
- 模型、上游源码和构建产物不会提交到 Git
- 提供本地 Web 控制台，用于硬件监控和模型管理

图像理解、浮点向量生成、Qdrant 存储和相似图片检索尚在规划中，详细状态、
接口草案与实施顺序请查看
[图像理解与向量检索路线图](./VISION_VECTOR_ROADMAP.md)。

## 快速开始

### 环境要求

- Intel Mac 或黑苹果，`uname -m` 输出必须为 `x86_64`
- macOS 能正常驱动、支持 Metal 的 AMD GPU
- macOS Command Line Tools
- [Homebrew](https://brew.sh/)
- 默认模型和构建文件至少需要 12 GB 可用磁盘空间

先检查系统是否识别显卡：

```bash
system_profiler SPDisplaysDataType
```

输出中应包含 AMD GPU，并显示 `Metal: Supported`。

### 安装与运行

```bash
git clone https://github.com/zhentianxiang/macos-amd-llama.git
cd macos-amd-llama

make setup
make doctor
make download
make run
```

Intel CPU 首次编译 Vulkan 版本可能需要几分钟。安装脚本默认检出已经验证的
llama.cpp 提交：

```text
992c325323f925cb82c86778e5e91a63de199063
```

高级用户可以通过 `LLAMA_REF` 指定其他版本。

另开一个终端测试 API：

```bash
make test
```

默认 API 地址：

```text
http://127.0.0.1:8080/v1
```

## Web 控制台

首次使用时安装前端依赖：

```bash
make dashboard-install
```

打开两个终端，分别运行：

```bash
make dashboard-agent
```

```bash
make dashboard-web
```

访问 <http://localhost:3000>。

控制台支持：

- 查看 CPU、系统内存和运行时间
- 查看 GPU 活动率、显存、温度、功耗、风扇与频率
- 查看本地 GGUF 模型
- 下载推荐模型并显示下载进度
- 启动、停止和切换模型
- 在浏览器中与当前模型进行连续对话
- 运行推理测速，查看提示词处理和生成速度
- 查看 llama-server 状态与 OpenAI 兼容接口地址

控制代理只监听 `127.0.0.1:8090`，llama-server 只监听
`127.0.0.1:8080`。如果 8080 端口已有手工启动的 llama-server，
面板会显示它处于在线状态，但不会停止或替换该外部进程，以避免误杀其他服务。

## 默认模型

下载脚本默认选择：

```text
Qwen3-8B-Q4_K_M.gguf
```

该模型大小约为 5 GB，适合 12 GB 显存，支持中英文对话，采用 Apache 2.0
许可证。

下载默认模型：

```bash
make download
```

下载其他 GGUF 模型：

```bash
MODEL_NAME="model.gguf" \
MODEL_URL="https://example.com/model.gguf" \
./scripts/download-model.sh
```

## 使用 wget 下载模型

Web 控制台可以直接下载模型。如果网络不稳定，也可以在命令行使用 `wget`
下载。`wget` 的 `-c`（`--continue`）参数支持断点续传：下载中断后重新执行
同一条命令，会从已有文件继续，而不是从头开始。

macOS 默认可能没有安装 `wget`，可以通过 Homebrew 安装：

```bash
brew install wget
```

进入项目目录并创建模型文件夹：

```bash
cd macos-amd-llama
mkdir -p models
```

默认使用 Hugging Face 官方地址：

```bash
export HF_BASE_URL="https://huggingface.co"
```

如果官方地址速度较慢，可以临时改用社区镜像：

```bash
export HF_BASE_URL="https://hf-mirror.com"
```

`hf-mirror.com` 是社区镜像，并非 Hugging Face 官方服务。不要向未知镜像
提交 Hugging Face Token 或其他敏感凭据。如果镜像不可用，请切回官方地址。

### 下载 Qwen3 8B Q4_K_M

```bash
wget -c \
  --tries=0 \
  --timeout=30 \
  --read-timeout=30 \
  -O models/Qwen3-8B-Q4_K_M.gguf \
  "$HF_BASE_URL/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf"
```

### 下载 Qwen3 14B Q4_K_M

```bash
wget -c \
  --tries=0 \
  --timeout=30 \
  --read-timeout=30 \
  -O models/Qwen3-14B-Q4_K_M.gguf \
  "$HF_BASE_URL/Qwen/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf"
```

### 下载 Gemma 3 12B Q4_K_M

Gemma 3 是视觉语言模型。图片理解除了主模型，还需要下载对应的视觉投影
文件 `mmproj`。两个文件缺一不可。

下载主模型：

```bash
wget -c \
  --tries=0 \
  --timeout=30 \
  --read-timeout=30 \
  -O models/gemma-3-12b-it-Q4_K_M.gguf \
  "$HF_BASE_URL/ggml-org/gemma-3-12b-it-GGUF/resolve/main/gemma-3-12b-it-Q4_K_M.gguf"
```

下载视觉投影文件：

```bash
wget -c \
  --tries=0 \
  --timeout=30 \
  --read-timeout=30 \
  -O models/mmproj-gemma-3-12b-f16.gguf \
  "$HF_BASE_URL/ggml-org/gemma-3-12b-it-GGUF/resolve/main/mmproj-model-f16.gguf"
```

### 验证模型文件

文件大小正确不代表内容一定完整。下载完成后应使用 SHA-256 校验，避免损坏
模型产生乱码。

验证 Qwen3 8B：

```bash
printf '%s  %s\n' \
  "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785" \
  "models/Qwen3-8B-Q4_K_M.gguf" |
  shasum -a 256 -c -
```

验证 Qwen3 14B：

```bash
printf '%s  %s\n' \
  "500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0" \
  "models/Qwen3-14B-Q4_K_M.gguf" |
  shasum -a 256 -c -
```

验证 Gemma 3 主模型和视觉文件：

```bash
printf '%s  %s\n' \
  "7bb69bff3f48a7b642355d64a90e481182a7794707b3133890646b1efa778ff5" \
  "models/gemma-3-12b-it-Q4_K_M.gguf" |
  shasum -a 256 -c -

printf '%s  %s\n' \
  "30c02d056410848227001830866e0a269fcc28aaf8ca971bded494003de9f5a5" \
  "models/mmproj-gemma-3-12b-f16.gguf" |
  shasum -a 256 -c -
```

成功时会显示：

```text
models/模型文件名.gguf: OK
```

如果显示 `FAILED`，说明文件已经损坏。应先将损坏文件改名，然后重新执行对应
的 `wget -c` 命令：

```bash
mv models/损坏的模型.gguf models/损坏的模型.gguf.corrupt
```

下载并校验完成后，Web 控制台会在下一次刷新时自动识别模型，不需要再次点击
“下载”。

## 运行配置

`scripts/run.sh` 支持以下环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MODEL_PATH` | `models/Qwen3-8B-Q4_K_M.gguf` | 模型文件的绝对或项目相对路径 |
| `LLAMA_HOST` | `127.0.0.1` | 监听地址 |
| `LLAMA_PORT` | `8080` | HTTP 端口 |
| `CTX_SIZE` | `8192` | 上下文长度 |
| `GPU_LAYERS` | `99` | 请求卸载到 GPU 的模型层数 |

项目根目录支持 `.env` 配置。可以从示例文件开始：

```bash
cp .env.example .env
```

Web 控制台相关变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DASHBOARD_WEB_HOST` | `127.0.0.1` | Web 页面监听地址 |
| `DASHBOARD_WEB_PORT` | `3000` | Web 页面端口 |
| `DASHBOARD_AGENT_HOST` | `127.0.0.1` | 控制代理监听地址 |
| `DASHBOARD_AGENT_PORT` | `8090` | 控制代理端口 |
| `DASHBOARD_ALLOWED_ORIGINS` | 空 | 允许访问代理的额外 Web 来源，多个地址用逗号分隔 |

Web 对话支持多轮上下文。浏览器会把当前会话中的历史问答一并发送给模型，
聊天窗口顶部会显示已对话轮数，并可使用“清空上下文”开始新会话。
`CTX_SIZE` 默认为 `8192` tokens，是历史消息、当前问题和模型回答共享的总窗口；
单次回答当前最多生成 `1024` tokens。需要降低内存占用时可改为 `4096`，
但 12 GB RX 6700 XT 建议优先保留默认的 `8192`。

示例：

```bash
MODEL_PATH="$PWD/models/another-model.gguf" \
CTX_SIZE=4096 \
LLAMA_PORT=8081 \
make run
```

除非明确需要远程访问，否则请保留默认监听地址 `127.0.0.1`。
服务默认没有配置 API Key，不应直接暴露到公网。

## 调用 OpenAI 兼容 API

### curl

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

### Python

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

## 验证显卡调用

运行诊断：

```bash
make doctor
```

预期设备输出：

```text
Vulkan0: AMD Radeon RX 6700 XT
```

对已下载模型进行性能测试：

```bash
VK_ICD_FILENAMES="$(brew --prefix molten-vk)/etc/vulkan/icd.d/MoltenVK_icd.json" \
./llama.cpp/build-vulkan/bin/llama-bench \
  -m ./models/Qwen3-8B-Q4_K_M.gguf \
  -ngl 99 \
  -fa 0
```

## 为什么不用 Docker Compose？

Docker Desktop for macOS 在 Linux 虚拟机中运行容器。该虚拟机无法获得 macOS
的 Metal 设备，也不会提供 Linux 原生 AMD GPU 所需的 `/dev/dri` 或
`/dev/kfd`。容器镜像可以使用 CPU 运行，但无法复现本项目的宿主机 GPU 调用链。

在原生 Linux 主机上，可以向容器传入 `/dev/dri`，使用 ROCm 时还可以传入
`/dev/kfd`。但这是另一种部署环境，不适用于本项目所针对的 Intel 黑苹果。

## 故障排查

### 找不到 Vulkan 设备

运行：

```bash
make doctor
```

确认 Homebrew 已安装 `molten-vk`，并且 MoltenVK 的 ICD JSON 文件存在。

### 原生 Metal 输出乱码或重复符号

不要把本项目切换到 `GGML_METAL=ON`。Intel macOS 上的部分 AMD 独立显卡可能
跑分看似正常，但返回错误 token。请继续使用本项目提供的 Vulkan 构建。

### 显存或内存不足

降低上下文长度：

```bash
CTX_SIZE=4096 make run
```

也可以改用体积更小的 `Q4_K_M` GGUF 模型。

### 局域网可以访问服务

不要复用系统的 `HOST` 环境变量。本项目使用独立的 `LLAMA_HOST`，默认值为
`127.0.0.1`。

## 上游项目

- [llama.cpp](https://github.com/ggml-org/llama.cpp)
- [MoltenVK](https://github.com/KhronosGroup/MoltenVK)
- [Qwen3-8B-GGUF](https://huggingface.co/Qwen/Qwen3-8B-GGUF)
