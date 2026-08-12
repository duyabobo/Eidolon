import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
      "/skills": "http://localhost:8000",
      "/mcp": "http://localhost:8000",
      "/health": "http://localhost:8000",
      // skill-creator 单轮可能串行多次 LLM，需长于默认超时
      "/config": {
        target: "http://localhost:8000",
        changeOrigin: true,
        timeout: 300_000,
        proxyTimeout: 300_000,
      },
    },
  },
});
