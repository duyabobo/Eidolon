import http, { IncomingMessage, ServerResponse } from "http";
import httpProxy from "http-proxy";
import { createReadStream, existsSync, statSync } from "fs";
import { extname, join, normalize } from "path";

/**
 * 前端代码里的 fetch 都是相对路径（如 `/sessions`、`/skills`），这是沿用 nginx.conf /
 * vite.config.ts 代理配置的产品前提，不改前端源码。桌面端没有 nginx，用这个本机 HTTP
 * 服务器复刻同样的路由划分：API 前缀转发给 cm-server，其余请求当静态文件 + SPA history
 * fallback（BrowserRouter 需要）。
 */
const API_PATH_PREFIXES = ["/sessions", "/conversations", "/skills", "/mcp", "/health", "/config"];

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function isApiRequest(path: string): boolean {
  return API_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function serveStaticFile(frontendDir: string, requestPath: string, res: ServerResponse): void {
  const safeRelativePath = normalize(requestPath).replace(/^([.]{2}[/\\])+/, "");
  let filePath = join(frontendDir, safeRelativePath);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA history fallback：BrowserRouter 的深链路由（如 /admin/knowledge）刷新时落到这里
    filePath = join(frontendDir, "index.html");
  }

  const contentType = MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  createReadStream(filePath).pipe(res);
}

export function startStaticAndProxyServer(options: {
  port: number;
  frontendDir: string;
  cmServerPort: number;
}): http.Server {
  const proxy = httpProxy.createProxyServer({
    target: { host: "127.0.0.1", port: options.cmServerPort },
    ws: false,
    xfwd: false,
  });

  // SSE 长连接失败大多是因为响应被缓冲，Node http-proxy 默认按流转发不缓冲，无需额外配置；
  // 出错时兜底返回 502 而不是让连接悬挂。
  proxy.on("error", (err: Error, _req: IncomingMessage, res: ServerResponse | import("net").Socket) => {
    console.error("[static-server] 代理到 cm-server 失败:", err.message);
    if (res instanceof ServerResponse && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "cm-server 暂不可用" }));
    }
  });

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (isApiRequest(url.pathname)) {
      proxy.web(req, res);
      return;
    }
    serveStaticFile(options.frontendDir, url.pathname === "/" ? "/index.html" : url.pathname, res);
  });

  server.listen(options.port, "127.0.0.1");
  return server;
}
