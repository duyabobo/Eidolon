/**
 * Socket Bridge：在 pi-runtime 进程中为沙盒提供"网络白名单"。
 *
 *   /tmp/pi-socks/mcp.sock  →  mcp-proxy TCP
 *
 * LLM 出口按 session 维度由 session-llm-bridge.ts 管理（注入 X-Session-Id / X-Question-Id）。
 */
import net from "net";
import fs from "fs";
import path from "path";

export const SOCKS_DIR = "/tmp/pi-socks";

const MCP_SOCK = path.join(SOCKS_DIR, "mcp.sock");

/**
 * 创建一个 Unix socket 服务器，将入站连接透明转发到 targetHost:targetPort。
 * 纯字节管道，不解析协议，支持 HTTP、SSE 等所有 TCP 上层协议。
 */
function createUnixSocketProxy(
  sockPath: string,
  targetHost: string,
  targetPort: number
): net.Server {
  const server = net.createServer((clientConn) => {
    const targetConn = net.connect(targetPort, targetHost);

    clientConn.pipe(targetConn);
    targetConn.pipe(clientConn);

    clientConn.on("error", () => targetConn.destroy());
    targetConn.on("error", () => clientConn.destroy());
    clientConn.on("close", () => targetConn.destroy());
    targetConn.on("close", () => clientConn.destroy());
  });

  server.on("error", (err) => {
    console.error(`[socket-bridge] 错误 sock=${sockPath}:`, err.message);
  });

  server.listen(sockPath, () => {
    console.log(
      `[socket-bridge] ${sockPath} → ${targetHost}:${targetPort}`
    );
  });

  return server;
}

/**
 * 启动 MCP Unix socket 代理服务器。
 * LLM 代理由 registerSessionLlmBridge 按 session 注册。
 */
export function startSocketBridge(
  _llmProxyHost: string,
  _llmProxyPort: number,
  mcpProxyHost: string,
  mcpProxyPort: number
): void {
  fs.mkdirSync(SOCKS_DIR, { recursive: true });
  fs.mkdirSync(path.join(SOCKS_DIR, "sessions"), { recursive: true });

  try { fs.unlinkSync(MCP_SOCK); } catch { /* 不存在则忽略 */ }

  createUnixSocketProxy(MCP_SOCK, mcpProxyHost, mcpProxyPort);
}
