import type { IncomingMessage } from "node:http";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** 与 React Router 页面同名的 API 根路径；仅这些 exact path 在浏览器导航时回退 SPA */
const SPA_PAGE_API_PATHS = new Set(["/skills", "/mcp", "/config"]);

/** SPA 页面与 API 前缀同名时：浏览器导航（Accept 含 text/html）回退前端，fetch 仍代理后端 */
function spaPageBypass(req: IncomingMessage): string | undefined {
  const path = (req.url ?? "").split("?", 1)[0];
  if (!SPA_PAGE_API_PATHS.has(path)) {
    return undefined;
  }
  if (req.headers.accept?.includes("text/html")) {
    return "/index.html";
  }
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    // 同名的 .js 为历史产物，优先使用 .tsx/.ts 源码
    extensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
  },
  server: {
    port: 3000,
    // cm-server 合并了原 gateway/gateway-sse/admin/llm-proxy/mcp-proxy，
    // 全部 API 路径现在指向同一个后端（本机 uvicorn cm_server.main:app --port 8000）。
    proxy: {
      // SSE 长连接：正则 key（以 ^ 开头）需先于下面的 /sessions 前缀匹配到
      "^/sessions/.*/stream": {
        target: "http://localhost:8000",
        changeOrigin: true,
        timeout: 0,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            const contentType = proxyRes.headers["content-type"];
            if (typeof contentType === "string" && contentType.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
      "/sessions": "http://localhost:8000",
      "/conversations": "http://localhost:8000",
      "/skills": {
        target: "http://localhost:8000",
        changeOrigin: true,
        bypass: spaPageBypass,
      },
      "/mcp": {
        target: "http://localhost:8000",
        changeOrigin: true,
        bypass: spaPageBypass,
      },
      "/health": "http://localhost:8000",
      // skill-creator 单轮可能串行多次 LLM，需长于默认超时
      "/config": {
        target: "http://localhost:8000",
        changeOrigin: true,
        timeout: 300_000,
        proxyTimeout: 300_000,
        bypass: spaPageBypass,
      },
    },
  },
});
