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
      // SSE 长连接：关闭超时压缩，避免开发态流式被缓冲/掐断
      "/sessions": {
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
      "/skills": "http://localhost:8000",
      "/mcp": "http://localhost:8000",    // skill 列表 → gateway
      "/health": "http://localhost:8000",
      "/config": "http://localhost:9000",    // LLM / MCP / Skill CRUD → admin
    },
  },
});
