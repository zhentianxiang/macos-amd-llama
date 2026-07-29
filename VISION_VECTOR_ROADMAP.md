# 图像理解与向量检索路线图

本文记录 `macos-amd-llama` 后续的图像理解、视觉问答、浮点向量生成、
Qdrant 存储与相似检索计划。文中标记为“未完成”的功能目前不可用，
用于避免把规划误认为已经实现。

## 目标

最终希望在 Intel 黑苹果与 AMD RX 6700 XT 上实现以下完整流程：

1. 用户上传图片。
2. Gemma 3 等视觉语言模型理解图片并生成描述、标签和视觉问答结果。
3. 专用向量模型把图片或描述转换为浮点向量（embedding）。
4. 将向量与图片元数据写入 Qdrant。
5. 支持使用文字或另一张图片检索相似图片。
6. 在 Web 控制台查看处理任务、图片详情和检索结果。

## 当前完成情况

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| AMD GPU 宿主机推理 | 已完成 | `llama.cpp -> Vulkan -> MoltenVK -> AMD GPU` |
| Gemma 3 12B GGUF 下载 | 已完成 | 模型商店与 `wget` 均可下载 |
| Gemma 3 视觉投影文件下载 | 已完成 | 已配置对应 `mmproj` 文件 |
| 启动视觉模型并传入 `--mmproj` | 已完成 | 控制台启动模型时会自动选择投影文件 |
| Web 图片上传 | 未完成 | 当前聊天窗口只接受文字 |
| 图片视觉问答 API | 未完成 | 代理目前只允许字符串消息 |
| 图片描述与结构化标签 | 未完成 | 尚未定义分析结果持久化 |
| 图片/文字浮点向量生成 | 未完成 | 尚未接入专用 embedding 模型 |
| Qdrant 服务 | 未完成 | 尚无 Compose 服务和集合初始化 |
| 图片入库与相似检索 | 未完成 | 尚无任务队列、索引及搜索 API |
| Web 图片库与搜索页面 | 未完成 | 尚无图片管理界面 |

## 重要设计原则

### 视觉语言模型不等于向量模型

Gemma 3 负责回答“图片里有什么、发生了什么、有哪些物体”等问题。
Qdrant 需要的是固定维度的浮点数组。后续应使用专用 embedding 模型生成向量，
不直接把聊天文本、模型内部状态或随意截取的浮点数当作图片向量。

计划维护两类命名向量：

- `visual`：由同一套图文编码器生成，支持“以图搜图”和“以文搜图”。
- `caption`：对视觉模型生成的中文描述做文本向量化，支持语义检索。

Qdrant 的 named vectors 允许两类向量使用不同维度和不同模型。
模型与维度确定后必须固定；升级模型时创建新集合，不在原集合中混用。

### 宿主机与 Docker 混合部署

AMD GPU 推理继续运行在 macOS 宿主机，因为 Docker Desktop 无法直接访问该显卡。
Qdrant 不需要 GPU，可以通过 Docker Compose 运行：

```text
浏览器
  │
  ▼
Dashboard Agent :8090
  ├── llama-server :8080（macOS 宿主机，AMD GPU，视觉理解）
  ├── embedding worker :8092（宿主机，先 CPU，后评估 Vulkan）
  ├── data/images（原图或缩略图）
  └── Qdrant :6333（Docker Compose，向量与元数据）
```

Qdrant 端口默认只绑定 `127.0.0.1`，持久数据使用 Docker volume。
镜像实现时应固定具体版本，不使用不可复现的浮动版本。

## 推荐的数据流程

### 图片入库

```text
上传图片
  -> 校验格式、大小与像素
  -> 计算 SHA-256，避免重复入库
  -> 保存原图并生成缩略图
  -> Gemma 3 生成描述、标签、物体和 OCR 摘要
  -> 图文编码器生成 visual 浮点向量
  -> 文本编码器将描述生成 caption 浮点向量
  -> 向 Qdrant 写入 named vectors 与 payload
  -> 返回图片 ID 和处理结果
```

### 相似检索

- 文字查询：分别生成跨模态 `visual` 查询向量与 `caption` 查询向量。
- 图片查询：生成 `visual` 查询向量。
- 混合查询：两路召回后按配置权重进行融合，再返回 Top K。
- 元数据过滤：支持时间、文件类型、标签、来源和模型版本过滤。

## Qdrant 集合设计

初始集合建议命名为 `image_assets_v1`。

### Named vectors

| 名称 | 用途 | 距离度量 | 维度 |
| --- | --- | --- | --- |
| `visual` | 以图搜图、以文搜图 | Cosine | 待选定图文模型后锁定 |
| `caption` | 中文描述语义检索 | Cosine | 待选定文本模型后锁定 |

第一阶段候选方案：

- 跨模态模型：SigLIP 或 CLIP 系列，必须使用配套的图片编码器和文字编码器。
- 中文描述向量：轻量多语言 E5 或 BGE 系列，先在 Intel CPU 上基准测试。

具体模型不能只看参数规模，还需验证 macOS x86_64 支持、内存占用、中文召回质量、
向量维度和许可证，再写入固定配置。

### Payload

```json
{
  "asset_id": "uuid",
  "sha256": "图片内容哈希",
  "source_name": "example.jpg",
  "mime_type": "image/jpeg",
  "width": 1920,
  "height": 1080,
  "file_size": 345678,
  "image_path": "data/images/uuid/original.jpg",
  "thumbnail_path": "data/images/uuid/thumb.webp",
  "caption": "图片的中文描述",
  "tags": ["人物", "室外"],
  "objects": ["汽车", "树"],
  "ocr_text": "",
  "vision_model": "gemma-3-12b-it-Q4_K_M",
  "visual_embedding_model": "待定",
  "caption_embedding_model": "待定",
  "created_at": "ISO-8601"
}
```

原图不存入 Qdrant payload。Qdrant 只保存向量、可过滤元数据和文件路径，
避免数据库体积失控。

## 计划中的接口

以下接口均为规划，尚未实现。正式实现统一放在 `/api/v1` 下。

### 服务状态

`GET /api/v1/vision/status`

返回视觉模型、投影文件、embedding worker、Qdrant 连接状态、集合名称与向量维度。

```json
{
  "vision": {"ready": true, "model": "gemma-3-12b-it-Q4_K_M.gguf"},
  "embedding": {"ready": true, "visualDimension": 768, "captionDimension": 384},
  "qdrant": {"ready": true, "collection": "image_assets_v1"}
}
```

### 图片理解

`POST /api/v1/vision/analyze`

请求使用 `multipart/form-data`：

- `image`：PNG、JPEG 或 WebP。
- `prompt`：可选问题，默认要求输出图片描述。
- `structured`：是否返回结构化结果。

响应：

```json
{
  "description": "一张城市街道的照片……",
  "tags": ["城市", "街道"],
  "objects": [{"name": "汽车", "confidence": null}],
  "ocrText": "",
  "model": "gemma-3-12b-it-Q4_K_M.gguf",
  "timings": {"totalMs": 3200}
}
```

视觉语言模型不一定提供可靠置信度；无法获得时返回 `null`，不伪造数字。

### 生成浮点向量

`POST /api/v1/embeddings/image`

接收一张图片，默认只返回模型名称、维度和向量哈希。调试时传
`includeVector=true` 才返回完整浮点数组，避免普通请求传输大量数据。

`POST /api/v1/embeddings/text`

```json
{
  "text": "夜晚城市中的红色汽车",
  "space": "visual",
  "includeVector": true
}
```

响应示例：

```json
{
  "model": "embedding-model-id",
  "space": "visual",
  "dimension": 768,
  "vector": [0.0123, -0.0441, 0.0087]
}
```

示例数组仅表示格式，实际数组长度必须与 `dimension` 完全一致。

### 图片入库

`POST /api/v1/images`

上传并创建异步处理任务，立即返回 `202 Accepted`：

```json
{
  "jobId": "uuid",
  "assetId": "uuid",
  "status": "queued"
}
```

`GET /api/v1/jobs/{jobId}` 返回阶段与进度：

```json
{
  "status": "running",
  "stage": "embedding",
  "progress": 70,
  "error": null
}
```

处理阶段固定为 `validating`、`analyzing`、`embedding`、`indexing` 和
`completed`，便于 Web 页面显示准确进度。

### 搜索

`POST /api/v1/images/search`

文字搜索请求：

```json
{
  "text": "海边的不锈钢雕塑",
  "mode": "hybrid",
  "limit": 20,
  "scoreThreshold": 0.3,
  "filters": {"tags": ["雕塑"]}
}
```

图片搜索使用 `multipart/form-data` 上传 `image`，并设置 `mode=visual`。
响应包含 `assetId`、相似度、命中的向量空间、缩略图、描述和标签。

### 管理

- `GET /api/v1/images/{assetId}`：图片详情与分析结果。
- `DELETE /api/v1/images/{assetId}`：删除向量与本地文件。
- `POST /api/v1/images/{assetId}/reindex`：重新分析并生成向量。
- `GET /api/v1/vector/collections`：集合和向量配置。
- `POST /api/v1/vector/reindex`：模型升级后的批量重建任务。

删除和重建属于有状态操作，接口实现时必须增加确认与错误恢复机制。

## OpenAI 兼容视觉消息

当前 Dashboard Agent 只接受字符串 `content`。视觉阶段需要支持 OpenAI 风格
的内容数组，并透传给带 `mmproj` 的 llama-server：

```json
{
  "model": "local",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "请描述这张图片"},
        {
          "type": "image_url",
          "image_url": {"url": "data:image/jpeg;base64,..."}
        }
      ]
    }
  ]
}
```

实现时必须限制 Base64 请求大小；图片库入库接口优先使用 multipart，
避免大图片长期占用 JSON 和浏览器内存。

## 配置变量规划

```dotenv
# Qdrant
QDRANT_URL=http://127.0.0.1:6333
QDRANT_COLLECTION=image_assets_v1
QDRANT_API_KEY=

# 图片文件
IMAGE_DATA_DIR=./data/images
IMAGE_MAX_MB=20
IMAGE_MAX_PIXELS=40000000

# 向量服务
EMBEDDING_HOST=127.0.0.1
EMBEDDING_PORT=8092
VISUAL_EMBEDDING_MODEL=
CAPTION_EMBEDDING_MODEL=

# 检索
SEARCH_DEFAULT_LIMIT=20
SEARCH_MAX_LIMIT=100
SEARCH_SCORE_THRESHOLD=0.30
```

`.env.example` 只放无密钥示例。真实 API Key 不得提交到 Git。

## 分阶段实施计划

### 第一阶段：Qdrant 基础设施

- 增加仅包含 Qdrant 的 `compose.yaml`。
- 固定镜像版本、端口、健康检查和持久 volume。
- 增加集合初始化、兼容性检查和备份说明。
- Dashboard 显示 Qdrant 在线状态。

验收：重启容器后测试向量仍存在，端口默认只允许本机访问。

### 第二阶段：视觉问答

- 扩展消息校验，允许文字与 `image_url` 内容块。
- Web 聊天增加图片选择、预览、移除和大小提示。
- 调用 Gemma 3 与对应 `mmproj`，支持流式视觉回答。
- 增加 PNG、JPEG、WebP 与超限错误测试。

验收：上传一张本地图片后，模型能连续回答至少两轮与图片相关的问题。

### 第三阶段：Embedding Worker

- 对候选跨模态与中文文本模型做 x86_64 CPU 基准。
- 固定模型、维度、归一化方法和许可证。
- 实现健康检查、批处理、超时与模型版本返回。
- 增加向量长度、有限浮点数和归一化校验。

验收：同一图片重复生成的向量维度一致且数值稳定，不出现 `NaN` 或 `Infinity`。

### 第四阶段：图片入库与检索

- 实现图片哈希去重、文件存储、缩略图和异步任务。
- 实现视觉分析、双向量生成和 Qdrant upsert。
- 实现文字、图片、混合检索与 payload 过滤。
- 删除失败时提供补偿操作，避免文件和向量状态不一致。

验收：至少 1,000 张测试图片可中断续建；文字和图片查询能返回可解释结果。

### 第五阶段：Web 图片工作台

- 增加拖拽上传、批量队列和实时阶段进度。
- 增加图片库、详情、视觉问答和相似图片面板。
- 显示向量模型、维度、集合版本与检索分数。
- 支持重新索引、删除确认和失败重试。

验收：常用流程无需命令行即可完成，并适配桌面与窄屏页面。

### 第六阶段：质量与运维

- 单元测试：图片校验、向量校验、payload 和过滤条件。
- 集成测试：视觉模型、embedding worker、Qdrant。
- 端到端测试：上传、分析、入库、检索、删除和重建。
- 增加数据备份、迁移、日志脱敏与容量监控。
- 记录 GPU/CPU 占用、每阶段耗时和失败原因。

## 风险与待确认项

- Gemma 3 12B Q4 加载后是否仍有足够内存同时运行 embedding worker。
- MoltenVK 下视觉模型和文字模型的正确性、速度及稳定性。
- embedding 模型在 Intel macOS 上使用 CPU、Vulkan 或其他运行时的实际差异。
- Qdrant 集合维度一旦创建不能随意修改，必须先完成模型选型基准。
- 图片可能包含隐私、EXIF 定位或敏感内容，需要明确清理和访问策略。
- 批量处理必须限制并发，避免统一内存、VRAM 和磁盘瞬时耗尽。

## 建议的下一步

从第一阶段开始：先增加 Qdrant Compose、健康检查和集合初始化，但暂不写入正式图片。
随后完成第二阶段视觉问答，确认 Gemma 3 在当前 RX 6700 XT 上能稳定理解图片，
再确定 embedding 模型和最终向量维度。这样可以避免过早创建无法兼容的向量集合。
