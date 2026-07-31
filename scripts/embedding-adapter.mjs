// 图片向量适配层：把 Local KB 后端的 llama.cpp 风格请求
// (content[] + prompt_string + multimodal_data[data_uri] + embd_normalize)
// 转换成 llama-server 实际接受的格式 ({content, image:[base64]})，
// 并把嵌套响应 [[vector]] 展平为 [vector]，供后端 body[0].embedding 直接读取。
import http from "node:http";

const HOST = process.env.EMBEDDING_ADAPTER_HOST || "0.0.0.0";
const PORT = Number(process.env.EMBEDDING_ADAPTER_PORT || 8093);
const UPSTREAM =
  process.env.EMBEDDING_ADAPTER_UPSTREAM ||
  `http://${process.env.LLAMA_HOST && !["0.0.0.0", "::"].includes(process.env.LLAMA_HOST) ? process.env.LLAMA_HOST : "127.0.0.1"}:${process.env.LLAMA_PORT || 8080}`;

function stripDataUri(value) {
  if (typeof value !== "string") return value;
  const comma = value.indexOf(",");
  if (comma >= 0 && value.slice(0, 5).toLowerCase().startsWith("data:")) {
    return value.slice(comma + 1);
  }
  return value;
}

function convertBackendPayload(body) {
  if (typeof body.content === "string" && Array.isArray(body.image)) {
    return { content: body.content, image: body.image.map(stripDataUri) };
  }
  if (Array.isArray(body.content)) {
    const promptParts = [];
    const images = [];
    for (const item of body.content) {
      if (item && typeof item.prompt_string === "string") {
        promptParts.push(item.prompt_string);
      }
      if (item && Array.isArray(item.multimodal_data)) {
        for (const data of item.multimodal_data) images.push(stripDataUri(data));
      }
    }
    if (!promptParts.length) promptParts.push("<__media__>\n");
    return { content: promptParts.join(""), image: images };
  }
  return body;
}

function flattenResponse(body) {
  if (Array.isArray(body)) {
    return body.map((item, index) => {
      let emb = item?.embedding;
      if (Array.isArray(emb) && emb.length === 1 && Array.isArray(emb[0])) emb = emb[0];
      return { index: item?.index ?? index, embedding: emb ?? [] };
    });
  }
  if (body && Array.isArray(body.data)) {
    return { ...body, data: flattenResponse(body.data) };
  }
  return body;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 32 * 1024 * 1024) reject(new Error("请求过大"));
    });
    request.on("end", () => resolve(data));
    request.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization" });
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!["/embeddings", "/v1/embeddings", "/embedding"].includes(url.pathname)) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "not found" }));
  }
  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const upstreamBody = convertBackendPayload(body);
    const upstream = new URL(UPSTREAM.replace(/\/$/, "") + "/embeddings");
    const headers = { "content-type": "application/json" };
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBody),
    });
    const text = await upstreamRes.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
    if (!upstreamRes.ok) {
      res.writeHead(upstreamRes.status, { "content-type": "application/json" });
      return res.end(JSON.stringify(parsed));
    }
    const out = flattenResponse(parsed);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(out));
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`embedding-adapter: http://${HOST}:${PORT}  ->  ${UPSTREAM}/embeddings`);
});
