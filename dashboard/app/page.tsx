"use client";

import { useEffect, useMemo, useState } from "react";

const AGENT = process.env.NEXT_PUBLIC_AGENT_URL || "http://127.0.0.1:8090";

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
  downloads: Array<{ id: string; name: string; received: number; total: number; status: string; error?: string }>;
  catalog: Array<{ id: string; name: string; file: string; sizeLabel: string; description: string }>;
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

function uptime(value: number) {
  const hours = Math.floor(value / 3600);
  return hours > 48 ? `${Math.floor(hours / 24)} 天` : `${hours} 小时`;
}

function Ring({ value, color = "#baff29", children }: { value: number; color?: string; children: React.ReactNode }) {
  const safe = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="ring" style={{ background: `conic-gradient(${color} ${safe * 3.6}deg, rgba(255,255,255,.08) 0deg)` }}>
      <div className="ring-core">{children}</div>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  return <div className="bar"><span style={{ width: `${Math.max(1, Math.min(100, value || 0))}%` }} /></div>;
}

export default function Home() {
  const [data, setData] = useState<Snapshot>(empty);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    try {
      const response = await fetch(`${AGENT}/api/status`, { cache: "no-store" });
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
      const response = await fetch(`${AGENT}${path}`, {
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
  const statusText = data.server.status === "running" ? "推理服务在线" : data.server.status === "starting" ? "模型加载中" : "推理服务未启动";

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
          ) : (
            <button className="primary" disabled={!!busy || !data.models.length} onClick={() => action("/api/server/start", { model: data.models[0]?.name })}>启动服务</button>
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
            <div className="metric-copy"><strong>{data.system.cpu.replace(/\(R\)|\(TM\)/g, "")}</strong><span>系统运行 {uptime(data.system.uptime)}</span></div>
          </div>
        </article>

        <article className="metric-card accent">
          <div className="card-head"><span>AMD GPU</span><small>Vulkan 设备 0</small></div>
          <div className="metric-main">
            <Ring value={data.gpu.activity} color="#ff6b38"><strong>{data.gpu.activity.toFixed(0)}%</strong><small>活动率</small></Ring>
            <div className="metric-copy"><strong>{data.gpu.name}</strong><span>{data.gpu.temperature || "—"}°C · {data.gpu.power || "—"} W · {data.gpu.fan || "—"} RPM</span></div>
          </div>
        </article>

        <article className="metric-card">
          <div className="card-head"><span>统一内存</span><small>{bytes(data.system.memoryTotal)}</small></div>
          <div className="big-value">{bytes(data.system.memoryUsed)}<small> 已使用</small></div>
          <Bar value={data.system.memoryPercent} />
          <div className="split-label"><span>{data.system.memoryPercent.toFixed(0)}%</span><span>{bytes(data.system.memoryTotal - data.system.memoryUsed)} 可用</span></div>
        </article>

        <article className="metric-card">
          <div className="card-head"><span>显存 VRAM</span><small>{bytes(data.gpu.vramTotal)}</small></div>
          <div className="big-value">{bytes(data.gpu.vramUsed)}<small> 已使用</small></div>
          <Bar value={data.gpu.vramTotal ? data.gpu.vramUsed / data.gpu.vramTotal * 100 : 0} />
          <div className="split-label"><span>{data.gpu.coreClock || "—"} MHz 核心</span><span>{data.gpu.memoryClock || "—"} MHz 显存</span></div>
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
              const downloaded = data.models.some((model) => model.name === item.file);
              const download = data.downloads.find((entry) => entry.id === item.id);
              const percent = download?.total ? Math.round(download.received / download.total * 100) : 0;
              return (
                <div className="store-row" key={item.id}>
                  <div><strong>{item.name}</strong><span>{item.description} · {item.sizeLabel}</span></div>
                  {download?.status === "downloading" ? <span className="download-progress">{percent}%</span> :
                    <button disabled={downloaded || !!busy} onClick={() => action("/api/models/download", { id: item.id })}>{downloaded ? "已下载" : "下载"}</button>}
                  {download?.status === "downloading" && <div className="download-bar"><span style={{ width: `${percent}%` }} /></div>}
                </div>
              );
            })}
          </article>
        </aside>
      </section>

      <footer><span>AMD Local AI Console</span><span>数据每 2 秒刷新 · 仅限本机访问</span><span>{activeModel ? `当前：${activeModel.name}` : "等待加载模型"}</span></footer>
    </main>
  );
}
