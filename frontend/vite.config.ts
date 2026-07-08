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
      "/sessions": "http://localhost:8000",
      "/skills": "http://localhost:8000",
      "/mcp": "http://localhost:8000",    // skill 列表 → gateway
      "/health": "http://localhost:8000",
      "/config": "http://localhost:9000",    // LLM / MCP / Skill CRUD → admin
    },
  },
});
