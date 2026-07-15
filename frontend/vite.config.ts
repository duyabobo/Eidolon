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
    proxy: {
      // SSE 长连接 → gateway-sse（独立扩容单元，按连接数而非 QPS 伸缩）
      // 正则 key（以 ^ 开头）需先于下面的 /sessions 前缀匹配到，否则会被转发到 gateway
      "^/sessions/.*/stream": {
        target: "http://localhost:8001",
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
      // session CRUD / 任务派发 → gateway
      "/sessions": "http://localhost:8000",
      "/skills": "http://localhost:8000",
      "/mcp": "http://localhost:8000",    // skill 列表 → gateway
      "/health": "http://localhost:8000",
      // skill-creator 单轮可能串行多次 LLM，需长于默认超时
      "/config": {
        target: "http://localhost:9000",
        changeOrigin: true,
        timeout: 300_000,
        proxyTimeout: 300_000,
      },
    },
  },
});
