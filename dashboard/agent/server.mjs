import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ENV_FILE = path.join(ROOT, ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const MODELS = path.join(ROOT, "models");
const HOST = process.env.DASHBOARD_AGENT_HOST || "127.0.0.1";
const PORT = Number(process.env.DASHBOARD_AGENT_PORT || 8090);
const LLAMA_HOST = process.env.LLAMA_HOST || "127.0.0.1";
const LLAMA_PORT = Number(process.env.LLAMA_PORT || 8080);
const LLAMA_CONNECT_HOST = ["0.0.0.0", "::"].includes(LLAMA_HOST) ? "127.0.0.1" : LLAMA_HOST;
const LLAMA_URL = `http://${LLAMA_CONNECT_HOST}:${LLAMA_PORT}`;
const WEB_PORT = Number(process.env.DASHBOARD_WEB_PORT || 3000);
const allowedOrigins = new Set([
  `http://localhost:${WEB_PORT}`,
  `http://127.0.0.1:${WEB_PORT}`,
  ...(process.env.DASHBOARD_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean),
]);

const catalog = [
  {
    id: "qwen3-8b-q4",
    name: "Qwen3 8B · Q4_K_M",
    file: "Qwen3-8B-Q4_K_M.gguf",
    sizeLabel: "约 5.0 GB",
    description: "中文对话与推理",
    multimodal: false,
    artifacts: [{
      file: "Qwen3-8B-Q4_K_M.gguf",
      url: "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf",
    }],
  },
  {
    id: "gemma3-12b-q4",
    name: "Gemma 3 12B · Q4_K_M",
    file: "gemma-3-12b-it-Q4_K_M.gguf",
    sizeLabel: "约 8.2 GB",
    description: "图像理解与视觉问答",
    multimodal: true,
    mmproj: "mmproj-gemma-3-12b-f16.gguf",
    artifacts: [
      {
        file: "gemma-3-12b-it-Q4_K_M.gguf",
        url: "https://huggingface.co/ggml-org/gemma-3-12b-it-GGUF/resolve/main/gemma-3-12b-it-Q4_K_M.gguf",
      },
      {
        file: "mmproj-gemma-3-12b-f16.gguf",
        url: "https://huggingface.co/ggml-org/gemma-3-12b-it-GGUF/resolve/main/mmproj-model-f16.gguf",
      },
    ],
  },
  {
    id: "qwen3-14b-q4",
    name: "Qwen3 14B · Q4_K_M",
    file: "Qwen3-14B-Q4_K_M.gguf",
    sizeLabel: "约 9.0 GB",
    description: "更强中文、代码与复杂推理",
    multimodal: false,
    artifacts: [{
      file: "Qwen3-14B-Q4_K_M.gguf",
      url: "https://huggingface.co/Qwen/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf",
    }],
  },
];

let serverProcess = null;
let managedModel = null;
let serverState = "stopped";
let lastError = "";
let serverStartedAt = 0;
let lastCpu = { idle: 0, total: 0 };
let performance = { promptTps: 0, generationTps: 0, latencyMs: 0 };
const downloads = new Map();

function cpuTimes() {
  return os.cpus().reduce((sum, cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    return { idle: sum.idle + cpu.times.idle, total: sum.total + total };
  }, { idle: 0, total: 0 });
}

function cpuPercent() {
  const now = cpuTimes();
  const idle = now.idle - lastCpu.idle;
  const total = now.total - lastCpu.total;
  lastCpu = now;
  return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0;
}
lastCpu = cpuTimes();

function statNumber(text, key) {
  const match = text.match(new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"=(\\d+)`));
  return match ? Number(match[1]) : 0;
}

async function gpuInfo() {
  try {
    const [{ stdout: profiler }, { stdout: ioreg }] = await Promise.all([
      execFileAsync("system_profiler", ["SPDisplaysDataType"]),
      execFileAsync("ioreg", ["-l", "-w", "0", "-r", "-c", "IOAccelerator"], { maxBuffer: 8 * 1024 * 1024 }),
    ]);
    const name = profiler.match(/Chipset Model:\s*(.+)/)?.[1]?.trim() || "AMD Radeon RX 6700 XT";
    const vramMatch = profiler.match(/VRAM \(Total\):\s*([\d.]+)\s*(GB|MB)/i);
    const reportedVram = vramMatch
      ? Number(vramMatch[1]) * (vramMatch[2].toUpperCase() === "GB" ? 1024 ** 3 : 1024 ** 2)
      : 0;
    const used = statNumber(ioreg, "inUseVidMemoryBytes");
    const free = statNumber(ioreg, "vramFreeBytes");
    return {
      name,
      activity: statNumber(ioreg, "GPU Activity(%)"),
      temperature: statNumber(ioreg, "Temperature(C)"),
      power: statNumber(ioreg, "Total Power(W)"),
      fan: statNumber(ioreg, "Fan Speed(RPM)"),
      coreClock: statNumber(ioreg, "Core Clock(MHz)"),
      memoryClock: statNumber(ioreg, "Memory Clock(MHz)"),
      vramUsed: used,
      vramTotal: reportedVram || used + free,
    };
  } catch {
    return { name: "AMD Radeon RX 6700 XT", activity: 0, temperature: 0, power: 0, fan: 0, coreClock: 0, memoryClock: 0, vramUsed: 0, vramTotal: 12 * 1024 ** 3 };
  }
}

async function modelList() {
  await fsp.mkdir(MODELS, { recursive: true });
  const entries = await fsp.readdir(MODELS, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".gguf") || entry.name.toLowerCase().startsWith("mmproj")) continue;
    const catalogItem = catalog.find((item) => item.file === entry.name);
    if (catalogItem?.mmproj && !fs.existsSync(path.join(MODELS, catalogItem.mmproj))) continue;
    const fullPath = path.join(MODELS, entry.name);
    const stat = await fsp.stat(fullPath);
    result.push({ name: entry.name, size: stat.size, path: fullPath, active: entry.name === managedModel && serverState === "running" });
  }
  return result.sort((a, b) => b.size - a.size);
}

async function health() {
  try {
    const response = await fetch(`${LLAMA_URL}/health`, { signal: AbortSignal.timeout(900) });
    if (!response.ok) return false;
    const body = await response.json().catch(() => ({}));
    return body.status === "ok" || body.status === "no slot available";
  } catch { return false; }
}

async function externalModel() {
  try {
    const response = await fetch(`${LLAMA_URL}/v1/models`, { signal: AbortSignal.timeout(900) });
    const result = await response.json();
    const id = result.data?.[0]?.id;
    return typeof id === "string" ? path.basename(id) : null;
  } catch { return null; }
}

async function snapshot() {
  const total = os.totalmem();
  const free = os.freemem();
  const [gpu, models, healthy] = await Promise.all([gpuInfo(), modelList(), health()]);
  if (healthy) {
    serverState = "running";
    serverStartedAt = 0;
  }
  if (!healthy && serverState === "starting" && serverStartedAt && Date.now() - serverStartedAt > 600_000) {
    serverState = "error";
    lastError = "模型启动超过 10 分钟仍未通过健康检查";
  }
  if (!healthy && !serverProcess && !["starting", "error"].includes(serverState)) serverState = "stopped";
  if (healthy && !managedModel) managedModel = await externalModel();
  return {
    system: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()} · ${os.arch()}`,
      cpu: os.cpus()[0]?.model || "Intel CPU",
      cpuPercent: cpuPercent(),
      cores: os.cpus().length,
      memoryUsed: total - free,
      memoryTotal: total,
      memoryPercent: ((total - free) / total) * 100,
      uptime: os.uptime(),
    },
    gpu,
    server: { status: serverState, model: managedModel, endpoint: LLAMA_URL, lastError },
    performance,
    models,
    downloads: [...downloads.values()],
    catalog: catalog.map((entry) => {
      const item = { ...entry };
      delete item.artifacts;
      delete item.mmproj;
      item.installed = entry.artifacts.every((artifact) => fs.existsSync(path.join(MODELS, artifact.file)));
      return item;
    }),
  };
}

function validModel(name) {
  return typeof name === "string" && path.basename(name) === name && name.toLowerCase().endsWith(".gguf");
}

async function startModel(name) {
  if (!validModel(name)) throw new Error("模型名称无效");
  const modelPath = path.join(MODELS, name);
  await fsp.access(modelPath, fs.constants.R_OK);
  if (serverProcess) await stopModel();
  if (await health()) throw new Error("端口 8080 已有外部 llama-server，请先停止它再切换模型");
  serverState = "starting";
  serverStartedAt = Date.now();
  lastError = "";
  managedModel = name;
  const catalogItem = catalog.find((item) => item.file === name);
  const mmprojPath = catalogItem?.mmproj ? path.join(MODELS, catalogItem.mmproj) : "";
  if (mmprojPath) await fsp.access(mmprojPath, fs.constants.R_OK);
  serverProcess = spawn(path.join(ROOT, "scripts/run.sh"), [], {
    cwd: ROOT,
    env: { ...process.env, MODEL_PATH: modelPath, MMPROJ_PATH: mmprojPath, LLAMA_PORT: String(LLAMA_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const onLog = (chunk) => {
    const line = chunk.toString();
    if (line.includes("server is listening") || line.includes("all slots are idle")) serverState = "running";
    if (line.toLowerCase().includes("error")) lastError = line.trim().slice(-500);
  };
  serverProcess.stdout.on("data", onLog);
  serverProcess.stderr.on("data", onLog);
  serverProcess.on("exit", (code) => {
    if (code && code !== 0) { serverState = "error"; lastError ||= `llama-server 退出，代码 ${code}`; }
    else serverState = "stopped";
    serverStartedAt = 0;
    serverProcess = null;
  });
}

async function stopModel() {
  if (!serverProcess) {
    if (await health()) throw new Error("当前服务不是由控制台启动，无法安全停止");
    serverState = "stopped";
    return;
  }
  const processToStop = serverProcess;
  processToStop.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => processToStop.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (serverProcess === processToStop) processToStop.kill("SIGKILL");
  serverProcess = null;
  serverState = "stopped";
  serverStartedAt = 0;
}

async function benchmark() {
  const started = Date.now();
  const response = await fetch(`${LLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "local", messages: [{ role: "user", content: "用一句中文介绍本地大语言模型。" }], max_tokens: 96, temperature: 0.2 }),
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "推理请求失败");
  performance = {
    promptTps: Number(result.timings?.prompt_per_second || 0),
    generationTps: Number(result.timings?.predicted_per_second || 0),
    latencyMs: Date.now() - started,
    updatedAt: new Date().toISOString(),
  };
  return performance;
}

function safeChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50) {
    throw new Error("对话消息数量无效");
  }
  return messages.map((message) => {
    if (!["user", "assistant", "system"].includes(message?.role) || typeof message?.content !== "string") {
      throw new Error("对话消息格式无效");
    }
    return { role: message.role, content: message.content.slice(0, 20_000) };
  });
}

async function chat(messages) {
  if (!await health()) throw new Error("推理服务未启动，请先加载一个模型");
  const safeMessages = safeChatMessages(messages);
  const started = Date.now();
  const response = await fetch(`${LLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "local", messages: safeMessages, max_tokens: 1024, temperature: 0.7 }),
    signal: AbortSignal.timeout(300000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "模型对话失败");
  performance = {
    promptTps: Number(result.timings?.prompt_per_second || 0),
    generationTps: Number(result.timings?.predicted_per_second || 0),
    latencyMs: Date.now() - started,
    updatedAt: new Date().toISOString(),
  };
  return { message: result.choices?.[0]?.message?.content || "", performance };
}

async function streamChat(messages, response, origin) {
  if (!await health()) throw new Error("推理服务未启动，请先加载一个模型");
  const safeMessages = safeChatMessages(messages);
  const started = Date.now();
  const upstream = await fetch(`${LLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "local", messages: safeMessages, max_tokens: 1024, temperature: 0.7, stream: true }),
    signal: AbortSignal.timeout(300000),
  });
  if (!upstream.ok || !upstream.body) {
    const result = await upstream.json().catch(() => ({}));
    throw new Error(result.error?.message || "模型对话失败");
  }
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "access-control-allow-origin": allowedOrigins.has(origin) ? origin : `http://localhost:${WEB_PORT}`,
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  const decoder = new TextDecoder();
  let inspectBuffer = "";
  for await (const chunk of upstream.body) {
    response.write(chunk);
    inspectBuffer += decoder.decode(chunk, { stream: true });
    const events = inspectBuffer.split("\n\n");
    inspectBuffer = events.pop() || "";
    for (const event of events) {
      const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed.timings) {
          performance = {
            promptTps: Number(parsed.timings.prompt_per_second || 0),
            generationTps: Number(parsed.timings.predicted_per_second || 0),
            latencyMs: Date.now() - started,
            updatedAt: new Date().toISOString(),
          };
        }
      } catch {}
    }
  }
  response.end();
}

async function downloadModel(id) {
  const item = catalog.find((entry) => entry.id === id);
  if (!item) throw new Error("不支持的模型");
  if (downloads.get(id)?.status === "downloading") return;
  if (item.artifacts.every((artifact) => fs.existsSync(path.join(MODELS, artifact.file)))) {
    throw new Error("模型已下载");
  }
  await fsp.mkdir(MODELS, { recursive: true });
  const state = {
    id,
    name: item.name,
    received: 0,
    total: 0,
    speed: 0,
    currentFile: "",
    filesComplete: 0,
    filesTotal: item.artifacts.length,
    status: "downloading",
    startedAt: Date.now(),
  };
  downloads.set(id, state);
  void (async () => {
    try {
      let transferred = 0;
      const pending = [];
      for (const artifact of item.artifacts) {
        const destination = path.join(MODELS, artifact.file);
        if (fs.existsSync(destination)) {
          const stat = await fsp.stat(destination);
          state.received += stat.size;
          state.total += stat.size;
          state.filesComplete += 1;
          continue;
        }
        const head = await fetch(artifact.url, { method: "HEAD", redirect: "follow" });
        if (!head.ok) throw new Error(`无法获取 ${artifact.file}：HTTP ${head.status}`);
        const size = Number(head.headers.get("content-length") || 0);
        state.total += size;
        pending.push({ ...artifact, destination });
      }

      for (const artifact of pending) {
        state.currentFile = artifact.file;
        const temp = `${artifact.destination}.part`;
        const existing = fs.existsSync(temp) ? (await fsp.stat(temp)).size : 0;
        const response = await fetch(artifact.url, {
          headers: existing ? { Range: `bytes=${existing}-` } : {},
          redirect: "follow",
        });
        if ((!response.ok && response.status !== 206) || !response.body) {
          throw new Error(`下载 ${artifact.file} 失败：HTTP ${response.status}`);
        }
        const canResume = existing > 0 && response.status === 206;
        if (canResume) state.received += existing;
        const stream = fs.createWriteStream(temp, { flags: canResume ? "a" : "w" });
        for await (const chunk of response.body) {
          state.received += chunk.length;
          transferred += chunk.length;
          state.speed = transferred / Math.max(1, (Date.now() - state.startedAt) / 1000);
          if (!stream.write(chunk)) await new Promise((resolve) => stream.once("drain", resolve));
        }
        await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
        await fsp.rename(temp, artifact.destination);
        state.filesComplete += 1;
      }
      state.received = state.total;
      state.speed = 0;
      state.currentFile = "";
      state.status = "complete";
    } catch (error) {
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
      state.speed = 0;
    }
  })();
}

async function jsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_048_576) throw new Error("请求过大");
  }
  return body ? JSON.parse(body) : {};
}

function send(response, status, payload, origin) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": allowedOrigins.has(origin) ? origin : "http://localhost:3000",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

const app = http.createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  if (request.method === "OPTIONS") return send(response, 204, {}, origin);
  if (origin && !allowedOrigins.has(origin)) return send(response, 403, { error: "不允许的来源" }, origin);
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/status") return send(response, 200, await snapshot(), origin);
    if (request.method !== "POST") return send(response, 404, { error: "未找到接口" }, origin);
    const body = await jsonBody(request);
    if (url.pathname === "/api/chat/stream") {
      await streamChat(body.messages, response, origin);
      return;
    }
    if (url.pathname === "/api/server/start") { await startModel(body.model); return send(response, 202, { message: "模型正在加载" }, origin); }
    if (url.pathname === "/api/server/stop") { await stopModel(); return send(response, 200, { message: "推理服务已停止" }, origin); }
    if (url.pathname === "/api/server/switch") { await startModel(body.model); return send(response, 202, { message: `正在切换到 ${body.model}` }, origin); }
    if (url.pathname === "/api/models/download") { await downloadModel(body.id); return send(response, 202, { message: "下载已经开始" }, origin); }
    if (url.pathname === "/api/inference/benchmark") return send(response, 200, { message: "速度测试完成", performance: await benchmark() }, origin);
    if (url.pathname === "/api/chat") return send(response, 200, await chat(body.messages), origin);
    return send(response, 404, { error: "未找到接口" }, origin);
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return;
    }
    send(response, 400, { error: error instanceof Error ? error.message : String(error) }, origin);
  }
});

app.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${HOST}:${PORT} 已被占用。代理可能已经启动，请先检查 http://${HOST}:${PORT}/api/status。`);
    process.exit(1);
  }
  console.error("控制代理启动失败：", error.message);
  process.exit(1);
});

app.listen(PORT, HOST, () => {
  console.log(`AMD Local AI agent: http://${HOST}:${PORT}`);
  console.log(`Project root: ${ROOT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (serverProcess) await stopModel().catch(() => {});
    app.close(() => process.exit(0));
  });
}
