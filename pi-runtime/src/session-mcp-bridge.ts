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
 *
 * 每轮意图可改写 X-Mcp-Tools：all=不带头，none=*none*，allow=具体工具名。
 */
import fs from "fs";
import http from "http";
import path from "path";

import { sessionSocksDir } from "./socket-bridge";
import type { McpMode } from "./turn-policy";

interface SessionMcpBridgeState {
  server: http.Server;
}

export interface McpTurnFilter {
  mode: McpMode;
  names: string[];
}

const sessionBridges = new Map<string, SessionMcpBridgeState>();
const sessionFilters = new Map<string, McpTurnFilter>();

function sessionMcpSockPath(sessionId: string): string {
  return path.join(sessionSocksDir(sessionId), "mcp.sock");
}

export function setSessionMcpTurnFilter(sessionId: string, filter: McpTurnFilter): void {
  sessionFilters.set(sessionId, filter);
  const hint =
    filter.mode === "allow"
      ? filter.names.join(",") || "-"
      : filter.mode;
  console.log(`[session-mcp-bridge] session=${sessionId}: 本轮 MCP 过滤 mode=${hint}`);
}

function currentFilter(sessionId: string): McpTurnFilter {
  return sessionFilters.get(sessionId) ?? { mode: "all", names: [] };
}

function mcpToolsHeaderValue(filter: McpTurnFilter): string | undefined {
  if (filter.mode === "all") return undefined;
  if (filter.mode === "none") return "*none*";
  if (filter.names.length === 0) return "*none*";
  return filter.names.join(",");
}

function buildSessionHeaders(
  incoming: http.IncomingHttpHeaders,
  userId: string,
  filter: McpTurnFilter,
): http.IncomingHttpHeaders {
  const headers = { ...incoming };
  headers["x-user-id"] = userId;
  delete headers["x-mcp-tools"];
  const value = mcpToolsHeaderValue(filter);
  if (value) {
    headers["x-mcp-tools"] = value;
  }
  return headers;
}

function createProxyHandler(
  sessionId: string,
  userId: string,
  targetHost: string,
  targetPort: number,
): http.RequestListener {
  return (req, res) => {
    const headers = buildSessionHeaders(req.headers, userId, currentFilter(sessionId));

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

  if (mcpToolNames && mcpToolNames.length > 0) {
    sessionFilters.set(sessionId, { mode: "allow", names: mcpToolNames });
  } else {
    sessionFilters.set(sessionId, { mode: "all", names: [] });
  }

  const handler = createProxyHandler(sessionId, userId, targetHost, targetPort);
  const server = http.createServer(handler);

  server.on("error", (err) => {
    console.error(`[session-mcp-bridge] session=${sessionId} 错误:`, err.message);
  });

  server.listen(sockPath, () => {
    const filter = currentFilter(sessionId);
    const filterHint =
      filter.mode === "allow"
        ? ` mcp_tools=${filter.names.join(",")}`
        : ` mcp_tools=${filter.mode.toUpperCase()}`;
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
  sessionFilters.delete(sessionId);
  try { fs.unlinkSync(sessionMcpSockPath(sessionId)); } catch { /* ignore */ }
  console.log(`[session-mcp-bridge] session=${sessionId}: bridge 已关闭`);
}

export function sessionMcpSockForSandbox(sessionId: string): string {
  return sessionMcpSockPath(sessionId);
}
