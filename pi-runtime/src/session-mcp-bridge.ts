/**
 * 按 session 维度的 MCP HTTP 代理桥：监听 Unix socket，为每个 HTTP 请求注入
 * X-User-Id 和 X-Mcp-Tools 头，再转发给内网 mcp-proxy。
 *
 * 白名单是工具粒度（X-Mcp-Tools），不是 Server 粒度：pi 进程从未见过任何业务
 * Server 名，SKILL.md 正文也只描述工具名，避免 Agent 误以为存在一个叫业务名的
 * Server 而去 mcp({ server: "业务名" })（一定会失败）。
 *
 * 关键设计：使用 http.createServer（而非 raw TCP pipe）
 * 原因：HTTP Keep-Alive 允许同一 TCP 连接发送多个请求。若使用 raw TCP pipe，
 * 只能在建立连接时注入一次 header，后续复用连接的请求（如 tools/list）会
 * 丢失 X-User-Id，导致 mcp-proxy 以 user=null 处理并返回 0 工具。
 * http.createServer 在应用层处理每条 HTTP 请求，确保每次都注入正确的 header。
 */
import fs from "fs";
import http from "http";
import path from "path";

import { sessionSocksDir } from "./socket-bridge";

interface SessionMcpBridgeState {
  server: http.Server;
}

const sessionBridges = new Map<string, SessionMcpBridgeState>();

function sessionMcpSockPath(sessionId: string): string {
  return path.join(sessionSocksDir(sessionId), "mcp.sock");
}

function buildSessionHeaders(
  incoming: http.IncomingHttpHeaders,
  userId: string,
  mcpToolNames: string[] | undefined,
): http.IncomingHttpHeaders {
  const headers = { ...incoming };
  // 覆盖 session 相关 header，防止客户端伪造
  headers["x-user-id"] = userId;
  delete headers["x-mcp-tools"];
  if (mcpToolNames && mcpToolNames.length > 0) {
    headers["x-mcp-tools"] = mcpToolNames.join(",");
  }
  return headers;
}

function createProxyHandler(
  userId: string,
  mcpToolNames: string[] | undefined,
  targetHost: string,
  targetPort: number,
): http.RequestListener {
  return (req, res) => {
    const headers = buildSessionHeaders(req.headers, userId, mcpToolNames);

    const proxyReq = http.request(
      {
        hostname: targetHost,
        port: targetPort,
        path: req.url,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      },
    );

    req.pipe(proxyReq, { end: true });

    proxyReq.on("error", (err) => {
      console.error(`[session-mcp-bridge] 代理请求失败: ${err.message}`);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  };
}

export function registerSessionMcpBridge(
  sessionId: string,
  userId: string,
  targetHost: string,
  targetPort: number,
  mcpToolNames?: string[],
): void {
  if (sessionBridges.has(sessionId)) return;

  const sockPath = sessionMcpSockPath(sessionId);
  fs.mkdirSync(path.dirname(sockPath), { recursive: true });
  try { fs.unlinkSync(sockPath); } catch { /* ignore */ }

  const handler = createProxyHandler(userId, mcpToolNames, targetHost, targetPort);
  const server = http.createServer(handler);

  server.on("error", (err) => {
    console.error(`[session-mcp-bridge] session=${sessionId} 错误:`, err.message);
  });

  server.listen(sockPath, () => {
    const filterHint =
      mcpToolNames && mcpToolNames.length > 0
        ? ` mcp_tools=${mcpToolNames.join(",")}`
        : " mcp_tools=ALL";
    console.log(
      `[session-mcp-bridge] session=${sessionId} user=${userId}:${filterHint} ${sockPath} → ${targetHost}:${targetPort}`,
    );
  });

  sessionBridges.set(sessionId, { server });
}

export function unregisterSessionMcpBridge(sessionId: string): void {
  const state = sessionBridges.get(sessionId);
  if (!state) return;
  state.server.close();
  sessionBridges.delete(sessionId);
  try { fs.unlinkSync(sessionMcpSockPath(sessionId)); } catch { /* ignore */ }
  console.log(`[session-mcp-bridge] session=${sessionId}: bridge 已关闭`);
}

export function sessionMcpSockForSandbox(sessionId: string): string {
  return sessionMcpSockPath(sessionId);
}
