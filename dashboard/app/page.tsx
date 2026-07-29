"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

const configuredAgent = process.env.NEXT_PUBLIC_AGENT_URL;
const agentPort = process.env.NEXT_PUBLIC_AGENT_PORT || "8090";
function agentUrl() {
  if (configuredAgent) return configuredAgent;
  const hostname = typeof window === "undefined" ? "127.0.0.1" : window.location.hostname;
  return `http://${hostname}:${agentPort}`;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

type Snapshot = {
  system: {
    hostname: string;
    platform: string;
    cpu: string;
    cpuPercent: number;
    cores: number;
    memoryUsed: number;
    memoryTotal: number;
    memoryPercent: number;
    uptime: number;
  };
  gpu: {
    name: string;
    activity: number;
    temperature: number;
    power: number;
    fan: number;
    coreClock: number;
    memoryClock: number;
    vramUsed: number;
    vramTotal: number;
  };
  server: {
    status: "running" | "starting" | "stopped" | "error";
    model: string | null;
    endpoint: string;
    lastError?: string;
  };
  performance: { promptTps: number; generationTps: number; latencyMs: number; updatedAt?: string };
  models: Array<{ name: string; size: number; path: string; active: boolean }>;
  downloads: Array<{ id: string; name: string; received: number; total: number; speed: number; currentFile: string; filesComplete: number; filesTotal: number; retryAttempt: number; status: string; error?: string }>;
  catalog: Array<{ id: string; name: string; file: string; sizeLabel: string; description: string; multimodal: boolean; installed: boolean }>;
};

const empty: Snapshot = {
  system: { hostname: "—", platform: "macOS", cpu: "正在连接本机代理", cpuPercent: 0, cores: 0, memoryUsed: 0, memoryTotal: 0, memoryPercent: 0, uptime: 0 },
  gpu: { name: "AMD Radeon", activity: 0, temperature: 0, power: 0, fan: 0, coreClock: 0, memoryClock: 0, vramUsed: 0, vramTotal: 0 },
  server: { status: "stopped", model: null, endpoint: "http://127.0.0.1:8080" },
  performance: { promptTps: 0, generationTps: 0, latencyMs: 0 },
  models: [], downloads: [], catalog: [],
};

function bytes(value: number) {
  if (!value) return "0 GB";
  return `${(value / 1024 ** 3).toFixed(value < 1024 ** 3 ? 2 : 1)} GB`;
}

function downloadSpeed(value: number) {
  return value ? `${(value / 1024 ** 2).toFixed(1)} MB/s` : "0 MB/s";
}

function uptime(value: number) {
  const hours = Math.floor(value / 3600);
  return hours > 48 ? `${Math.floor(hours / 24)} 天` : `${hours} 小时`;
}

function meterColor(value: number) {
  const safe = Math.max(0, Math.min(100, value || 0));
  const hue = 132 - safe * 1.32;
  return `hsl(${hue.toFixed(1)} 58% 40%)`;
}

function Ring({ value, children }: { value: number; children: React.ReactNode }) {
  const safe = Math.max(0, Math.min(100, value || 0));
  const color = meterColor(safe);
  return (
    <div
      className="ring"
      title={`当前使用率 ${safe.toFixed(0)}%`}
      style={{ background: `conic-gradient(${color} ${safe * 3.6}deg, #dce9da 0deg)` }}
    >
      <div className="ring-core">{children}</div>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<Snapshot>(empty);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [launcherPosition, setLauncherPosition] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef({ active: false, moved: false, offsetX: 0, offsetY: 0 });
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "你好，我是当前运行在 AMD GPU 上的本地模型。启动模型后，可以直接在这里与我对话。" },
  ]);

  const refresh = async () => {
    try {
      const response = await fetch(`${agentUrl()}/api/status`, { cache: "no-store" });
      if (!response.ok) throw new Error("agent offline");
      setData(await response.json());
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 2000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, []);

  const action = async (path: string, body?: unknown) => {
    setBusy(path);
    setNotice("");
    try {
      const response = await fetch(`${agentUrl()}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "操作失败");
      setNotice(result.message || "操作已提交");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy("");
    }
  };

  const activeModel = useMemo(
    () => data.models.find((model) => model.active) || data.models.find((model) => model.name === data.server.model),
    [data.models, data.server.model],
  );
  const modelName = data.server.model?.replace(/\.gguf$/i, "") || "未知模型";
  const statusText = data.server.status === "running"
    ? `正在运行：${modelName}`
    : data.server.status === "starting"
      ? `正在加载：${modelName}`
      : data.server.status === "error"
        ? `启动失败：${data.server.lastError || modelName}`
        : "推理服务未启动";

  const sendChat = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = chatInput.trim();
    if (!content || chatBusy || data.server.status !== "running") return;
    const nextMessages: ChatMessage[] = [...messages.filter((message, index) => !(index === 0 && message.role === "assistant")), { role: "user", content }];
    setMessages((current) => [...current, { role: "user", content }]);
    setChatInput("");
    setChatBusy(true);
    try {
      setMessages((current) => [...current, { role: "assistant", content: "" }]);
      const response = await fetch(`${agentUrl()}/api/chat/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      if (!response.ok || !response.body) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "对话失败");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const eventText of events) {
          const payload = eventText.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
          if (!payload || payload === "[DONE]") continue;
          const eventData = JSON.parse(payload);
          const delta = eventData.choices?.[0]?.delta?.content || "";
          if (delta) {
            setMessages((current) => current.map((message, index) =>
              index === current.length - 1 ? { ...message, content: message.content + delta } : message
            ));
          }
        }
      }
      await refresh();
    } catch (error) {
      setMessages((current) => current.map((message, index) =>
        index === current.length - 1 && message.role === "assistant"
          ? { ...message, content: `请求失败：${error instanceof Error ? error.message : "未知错误"}` }
          : message
      ));
    } finally {
      setChatBusy(false);
    }
  };

  const moveLauncher = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current.active) return;
    const left = Math.max(12, Math.min(window.innerWidth - 70, event.clientX - drag.current.offsetX));
    const top = Math.max(12, Math.min(window.innerHeight - 70, event.clientY - drag.current.offsetY));
    if (Math.abs(event.movementX) + Math.abs(event.movementY) > 1) drag.current.moved = true;
    setLauncherPosition({ left, top });
  };

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <div className="mark">A</div>
          <div><strong>AMD Local AI</strong><span>Hackintosh inference console</span></div>
        </div>
        <div className="top-actions">
          <span className={`connection ${connected ? "online" : ""}`}><i />{connected ? "本机代理已连接" : "本机代理离线"}</span>
          <span className="host">{data.system.hostname}</span>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow"><span>VULKAN</span> MOLTenVK · AMD GPU ACCELERATION</p>
          <h1>本地模型，<em>全速运行。</em></h1>
          <p className="lead">在一处监控 RX 6700 XT、管理 GGUF 模型并观察每一次推理。</p>
        </div>
        <div className={`server-state ${data.server.status}`}>
          <span className="pulse" />
          <div><small>LLAMA SERVER</small><strong>{statusText}</strong></div>
          {data.server.status === "running" ? (
            <button className="ghost danger" disabled={!!busy} onClick={() => action("/api/server/stop")}>停止服务</button>
          ) : data.server.status === "starting" ? (
            <button disabled>正在加载…</button>
          ) : (
            <button className="primary" disabled={!!busy || !data.models.length} onClick={() => action("/api/server/start", { model: data.models[0]?.name })}>{data.server.status === "error" ? "重试启动" : "启动服务"}</button>
          )}
        </div>
      </section>

      {!connected && <div className="warning">控制代理尚未连接。请在项目根目录运行 <code>make dashboard-agent</code>。</div>}
      {notice && <div className="toast" onClick={() => setNotice("")}>{notice}<span>×</span></div>}

      <section className="metrics">
        <article className="metric-card">
          <div className="card-head"><span>CPU</span><small>{data.system.cores} 线程</small></div>
          <div className="metric-main">
            <Ring value={data.system.cpuPercent}><strong>{data.system.cpuPercent.toFixed(0)}%</strong><small>使用率</small></Ring>
            <div className="metric-copy">
              <strong className="metric-title">{data.system.cpu.replace(/\(R\)|\(TM\)/g, "")}</strong>
              <div className="metric-details">
                <span><small>当前使用率</small>{data.system.cpuPercent.toFixed(0)}%</span>
                <span><small>系统运行</small>{uptime(data.system.uptime)}</span>
              </div>
            </div>
          </div>
        </article>

        <article className="metric-card accent">
          <div className="card-head"><span>AMD GPU</span><small>Vulkan 设备 0</small></div>
          <div className="metric-main">
            <Ring value={data.gpu.activity}><strong>{data.gpu.activity.toFixed(0)}%</strong><small>活动率</small></Ring>
            <div className="metric-copy gpu-copy">
              <strong className="metric-title">{data.gpu.name}</strong>
              <div className="metric-details telemetry">
                <span><small>温度</small>{data.gpu.temperature ? `${data.gpu.temperature} °C` : "—"}</span>
                <span><small>功耗</small>{data.gpu.power ? `${data.gpu.power} W` : "—"}</span>
                <span><small>风扇</small>{data.gpu.fan ? `${data.gpu.fan} RPM` : "—"}</span>
                <span><small>核心频率</small>{data.gpu.coreClock ? `${data.gpu.coreClock} MHz` : "—"}</span>
                <span><small>显存频率</small>{data.gpu.memoryClock ? `${data.gpu.memoryClock} MHz` : "—"}</span>
              </div>
            </div>
          </div>
        </article>

        <article className="metric-card">
          <div className="card-head"><span>统一内存</span><small>{bytes(data.system.memoryTotal)}</small></div>
          <div className="metric-main">
            <Ring value={data.system.memoryPercent}>
              <strong>{data.system.memoryPercent.toFixed(0)}%</strong>
              <small>已使用</small>
            </Ring>
            <div className="metric-copy memory-copy">
              <strong className="metric-title">{bytes(data.system.memoryUsed)}</strong>
              <div className="metric-details">
                <span><small>已使用</small>{bytes(data.system.memoryUsed)}</span>
                <span><small>可用</small>{bytes(Math.max(0, data.system.memoryTotal - data.system.memoryUsed))}</span>
                <span><small>总容量</small>{bytes(data.system.memoryTotal)}</span>
              </div>
            </div>
          </div>
        </article>

        <article className="metric-card">
          <div className="card-head"><span>显存 VRAM</span><small>{bytes(data.gpu.vramTotal)}</small></div>
          <div className="metric-main">
            <Ring value={data.gpu.vramTotal ? data.gpu.vramUsed / data.gpu.vramTotal * 100 : 0}>
              <strong>{data.gpu.vramTotal ? (data.gpu.vramUsed / data.gpu.vramTotal * 100).toFixed(0) : "0"}%</strong>
              <small>已使用</small>
            </Ring>
            <div className="metric-copy memory-copy">
              <strong className="metric-title">{bytes(data.gpu.vramUsed)}</strong>
              <div className="metric-details">
                <span><small>已使用</small>{bytes(data.gpu.vramUsed)}</span>
                <span><small>可用</small>{bytes(Math.max(0, data.gpu.vramTotal - data.gpu.vramUsed))}</span>
                <span><small>总容量</small>{bytes(data.gpu.vramTotal)}</span>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="workspace">
        <article className="panel models-panel">
          <div className="panel-title">
            <div><p>模型库</p><h2>本地 GGUF 模型</h2></div>
            <span>{data.models.length} 个已下载</span>
          </div>
          <div className="model-list">
            {data.models.length === 0 && <div className="empty">还没有模型，从右侧模型商店下载一个即可开始。</div>}
            {data.models.map((model) => (
              <div className={`model-row ${model.active ? "selected" : ""}`} key={model.path}>
                <div className="model-icon">Q</div>
                <div className="model-info"><strong>{model.name.replace(".gguf", "")}</strong><span>GGUF · {bytes(model.size)} · Vulkan</span></div>
                {model.active && <span className="active-pill">运行中</span>}
                {!model.active && <button disabled={!!busy} onClick={() => action("/api/server/switch", { model: model.name })}>加载模型</button>}
              </div>
            ))}
          </div>
          <div className="model-footer"><span>当前端点</span><code>{data.server.endpoint}</code></div>
        </article>

        <aside className="right-stack">
          <article className="panel speed-panel">
            <div className="panel-title"><div><p>推理性能</p><h2>实时吞吐</h2></div><span className="live-dot">LIVE</span></div>
            <div className="speed-grid">
              <div><strong>{data.performance.generationTps ? data.performance.generationTps.toFixed(1) : "—"}</strong><span>tokens / 秒</span><small>生成速度</small></div>
              <div><strong>{data.performance.promptTps ? data.performance.promptTps.toFixed(1) : "—"}</strong><span>tokens / 秒</span><small>提示词处理</small></div>
            </div>
            <button className="benchmark" disabled={data.server.status !== "running" || !!busy} onClick={() => action("/api/inference/benchmark")}>
              {busy.includes("benchmark") ? "正在测试…" : "运行一次速度测试"}
            </button>
          </article>

          <article className="panel store-panel">
            <div className="panel-title"><div><p>模型商店</p><h2>推荐模型</h2></div></div>
            {data.catalog.map((item) => {
              const downloaded = item.installed;
              const download = data.downloads.find((entry) => entry.id === item.id);
              const percent = download?.total ? Math.min(100, Math.round(download.received / download.total * 100)) : 0;
              return (
                <div className="store-row" key={item.id}>
                  <div>
                    <strong>{item.name}{item.multimodal && <b className="vision-tag">VISION</b>}</strong>
                    <span>{item.description} · {item.sizeLabel}</span>
                  </div>
                  {download?.status === "queued" ? <span className="download-progress">等待下载</span> :
                    download?.status === "downloading" ? <span className="download-progress">{percent}% · {downloadSpeed(download.speed)}</span> :
                    <button disabled={downloaded || !!busy} onClick={() => action("/api/models/download", { id: item.id })}>{downloaded ? "已下载" : "下载"}</button>}
                  {download?.status === "downloading" && <>
                    <div className="download-meta">
                      <span>{bytes(download.received)} / {bytes(download.total)}</span>
                      <span>{download.filesComplete}/{download.filesTotal} 文件 · {download.currentFile}</span>
                    </div>
                    {download.error && <div className="download-retrying">{download.error}</div>}
                    <div className="download-bar"><span style={{ width: `${percent}%` }} /></div>
                  </>}
                  {download?.status === "error" && <div className="download-error">{download.error || "下载失败，请点击重试"}</div>}
                </div>
              );
            })}
          </article>
        </aside>
      </section>

      <footer><span>AMD Local AI Console</span><span>数据每 2 秒刷新 · 仅限本机访问</span><span>{activeModel ? `当前：${activeModel.name}` : "等待加载模型"}</span></footer>

      {chatOpen && <aside className="floating-chat">
        <div className="floating-chat-head">
          <div><small>当前模型</small><strong>{data.server.model || "尚未加载模型"}</strong></div>
          <button aria-label="关闭聊天窗口" onClick={() => setChatOpen(false)}>×</button>
        </div>
        <div className="chat-messages">
          {messages.map((message, index) => (
            <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
              <span>{message.role === "user" ? "你" : "AI"}</span>
              <div className="markdown"><ReactMarkdown>{message.content || (chatBusy && index === messages.length - 1 ? "正在生成回答…" : "")}</ReactMarkdown></div>
            </div>
          ))}
        </div>
        <form className="chat-compose" onSubmit={sendChat}>
          <textarea
            aria-label="对话内容"
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={data.server.status === "running" ? "输入消息，Enter 发送…" : "请先加载模型"}
            disabled={data.server.status !== "running" || chatBusy}
          />
          <button className="primary send-button" type="submit" disabled={!chatInput.trim() || chatBusy || data.server.status !== "running"}>
            {chatBusy ? "生成中" : "发送"}
          </button>
        </form>
      </aside>}
      <button
        className={`ai-launcher ${chatOpen ? "open" : ""}`}
        style={launcherPosition ? { left: launcherPosition.left, top: launcherPosition.top, right: "auto", bottom: "auto" } : undefined}
        aria-label="打开本地 AI 对话"
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          drag.current = { active: true, moved: false, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={moveLauncher}
        onPointerUp={() => {
          if (!drag.current.moved) setChatOpen((value) => !value);
          drag.current.active = false;
        }}
      >
        AI
        <span className={data.server.status === "running" ? "online" : ""} />
      </button>
    </main>
  );
}
