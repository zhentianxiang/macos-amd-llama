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
const MODELS = path.join(ROOT, "models");
const PORT = Number(process.env.DASHBOARD_AGENT_PORT || 8090);
const LLAMA_PORT = Number(process.env.LLAMA_PORT || 8080);
const LLAMA_URL = `http://127.0.0.1:${LLAMA_PORT}`;
const allowedOrigins = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);

const catalog = [
  {
    id: "qwen3-06b-q4",
    name: "Qwen3 0.6B · 轻量测试",
    file: "Qwen3-0.6B-Q4_K_M.gguf",
    sizeLabel: "约 400 MB",
    description: "启动快，适合验证环境",
    url: "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf",
  },
  {
    id: "qwen3-8b-q4",
    name: "Qwen3 8B · 推荐",
    file: "Qwen3-8B-Q4_K_M.gguf",
    sizeLabel: "约 5.0 GB",
    description: "中文能力与速度平衡",
    url: "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf",
  },
];

let serverProcess = null;
let managedModel = null;
let serverState = "stopped";
let lastError = "";
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
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".gguf")) continue;
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
  if (healthy && serverState !== "starting") serverState = "running";
  if (!healthy && !serverProcess && serverState !== "starting") serverState = "stopped";
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
    downloads: [...downloads.values()].map((entry) => {
      const item = { ...entry };
      delete item.url;
      return item;
    }),
    catalog: catalog.map((entry) => {
      const item = { ...entry };
      delete item.url;
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
  lastError = "";
  managedModel = name;
  serverProcess = spawn(path.join(ROOT, "scripts/run.sh"), [], {
    cwd: ROOT,
    env: { ...process.env, MODEL_PATH: modelPath, LLAMA_PORT: String(LLAMA_PORT) },
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

async function downloadModel(id) {
  const item = catalog.find((entry) => entry.id === id);
  if (!item) throw new Error("不支持的模型");
  if (downloads.get(id)?.status === "downloading") return;
  const destination = path.join(MODELS, item.file);
  if (fs.existsSync(destination)) throw new Error("模型已下载");
  await fsp.mkdir(MODELS, { recursive: true });
  const temp = `${destination}.part`;
  const state = { id, name: item.name, received: 0, total: 0, status: "downloading", url: item.url };
  downloads.set(id, state);
  void (async () => {
    try {
      const response = await fetch(item.url, { redirect: "follow" });
      if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
      state.total = Number(response.headers.get("content-length") || 0);
      const stream = fs.createWriteStream(temp);
      for await (const chunk of response.body) {
        state.received += chunk.length;
        if (!stream.write(chunk)) await new Promise((resolve) => stream.once("drain", resolve));
      }
      await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
      await fsp.rename(temp, destination);
      state.status = "complete";
    } catch (error) {
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  })();
}

async function jsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error("请求过大");
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
    if (url.pathname === "/api/server/start") { await startModel(body.model); return send(response, 202, { message: "模型正在加载" }, origin); }
    if (url.pathname === "/api/server/stop") { await stopModel(); return send(response, 200, { message: "推理服务已停止" }, origin); }
    if (url.pathname === "/api/server/switch") { await startModel(body.model); return send(response, 202, { message: `正在切换到 ${body.model}` }, origin); }
    if (url.pathname === "/api/models/download") { await downloadModel(body.id); return send(response, 202, { message: "下载已经开始" }, origin); }
    if (url.pathname === "/api/inference/benchmark") return send(response, 200, { message: "速度测试完成", performance: await benchmark() }, origin);
    return send(response, 404, { error: "未找到接口" }, origin);
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : String(error) }, origin);
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`AMD Local AI agent: http://127.0.0.1:${PORT}`);
  console.log(`Project root: ${ROOT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (serverProcess) await stopModel().catch(() => {});
    app.close(() => process.exit(0));
  });
}
