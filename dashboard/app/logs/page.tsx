"use client";

import { useEffect, useRef, useState } from "react";

function agentUrl() {
  const hostname = typeof window === "undefined" ? "127.0.0.1" : window.location.hostname;
  return `http://${hostname}:${process.env.NEXT_PUBLIC_AGENT_PORT || "8090"}`;
}

type LogEntry = {
  ts: number;
  type: "service" | "request";
  level: string;
  msg?: string;
  path?: string;
  method?: string;
  status?: number;
  duration?: number;
  source?: string;
  detail?: string;
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "service" | "request" | "error">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    const poll = async () => {
      try {
        const res = await fetch(`${agentUrl()}/api/logs`, { cache: "no-store" });
        const data = await res.json();
        setLogs(data.logs || []);
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    void poll();
    timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (autoScroll) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, autoScroll]);

  const filtered = logs.filter((e) => {
    if (filter === "service") return e.type === "service";
    if (filter === "request") return e.type === "request";
    if (filter === "error") return e.level === "error";
    return true;
  });

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
  };

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 28px" }}>
      <header className="topbar" style={{ height: 64, marginBottom: 20 }}>
        <div className="brand">
          <div className="mark" style={{ width: 32, height: 32, fontSize: 16, borderRadius: 8 }}>L</div>
          <div><strong style={{ fontSize: 15 }}>推理日志</strong><span>SERVICE &amp; REQUEST LOGS</span></div>
        </div>
        <div className="top-actions">
          <a href="/" style={{ fontSize: 13, color: "var(--green)" }}>← 返回主页</a>
        </div>
      </header>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        {(["all","service","request","error"] as const).map((f) => (
          <button key={f} className={filter === f ? "primary" : ""} style={{ fontSize: 13, padding: "7px 13px" }} onClick={() => setFilter(f)}>
            {{all:"全部",service:"服务日志",request:"请求活动",error:"仅错误"}[f]}
          </button>
        ))}
        <label style={{ fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 5, marginLeft: "auto" }}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} style={{ accentColor: "var(--green)" }} />
          自动滚动
        </label>
        <span style={{ fontSize: 13, color: connected ? "#48a865" : "#d86656" }}>
          {connected ? "● 代理已连接" : "● 代理离线"}
        </span>
      </div>

      <div style={{
        background: "#f7f9f6", border: "1px solid var(--line)", borderRadius: 12,
        padding: 14, fontFamily: "ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.7,
        height: "calc(100vh - 220px)", overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {filtered.length === 0 ? (
          <div style={{ color: "var(--muted)", textAlign: "center", paddingTop: 40 }}>暂无日志记录</div>
        ) : filtered.map((e, i) => {
          const tag = e.type === "service" ? "服务" : "请求";
          const levelColor = e.level === "error" ? "#c24e3f" : e.level === "warn" ? "#a66b12" : "#476453";
          const text = e.type === "service"
            ? e.msg
            : `${e.method} ${e.path} ${e.status}  ${e.duration}ms  [${e.source}]${e.detail ? "  " + e.detail : ""}`;
          return (
            <div key={i} style={{ padding: "2px 0", borderBottom: "1px dashed #e2ece0" }}>
              <span style={{ color: "#9aa89a" }}>{fmtTime(e.ts)} </span>
              <span style={{ color: levelColor, fontWeight: 700 }}>[{tag}] </span>
              <span style={{ color: "#3a4a3a" }}>{text}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </main>
  );
}
