/**
 * 按 session 维度的 MCP HTTP 桥：转发前注入 X-User-Id，供 mcp-proxy 加载个人 MCP。
 */
import fs from "fs";
import net from "net";
import path from "path";

import { SOCKS_DIR } from "./socket-bridge";

const HEADER_END = Buffer.from("\r\n\r\n");
const CRLF = "\r\n";

interface SessionMcpBridgeState {
  server: net.Server;
}

const sessionBridges = new Map<string, SessionMcpBridgeState>();

function sessionMcpSockPath(sessionId: string): string {
  return path.join(SOCKS_DIR, "sessions", sessionId, "mcp.sock");
}

function parseContentLength(headerText: string): number | null {
  const match = headerText.match(/^content-length:\s*(\d+)/im);
  return match ? Number.parseInt(match[1], 10) : null;
}

function injectUserHeader(requestBuffer: Buffer, userId: string): Buffer {
  const text = requestBuffer.toString("latin1");
  const sep = text.indexOf("\r\n\r\n");
  if (sep === -1) {
    return requestBuffer;
  }

  const head = text.slice(0, sep);
  const body = text.slice(sep + 4);
  const lines = head.split("\r\n");
  const keptHeaders = lines.slice(1).filter((line) => !line.toLowerCase().startsWith("x-user-id:"));
  keptHeaders.push(`X-User-Id: ${userId}`);

  const newHead = [lines[0], ...keptHeaders].join(CRLF);
  return Buffer.from(`${newHead}${CRLF}${CRLF}${body}`, "latin1");
}

function pipeBidirectional(a: net.Socket, b: net.Socket): void {
  a.on("data", (chunk) => b.write(chunk));
  b.on("data", (chunk) => a.write(chunk));
  a.on("error", () => b.destroy());
  b.on("error", () => a.destroy());
  a.on("close", () => b.destroy());
  b.on("close", () => a.destroy());
}

function handleClientConnection(
  client: net.Socket,
  userId: string,
  targetHost: string,
  targetPort: number,
): void {
  let buffer = Buffer.alloc(0);
  let forwarded = false;

  const onData = (chunk: Buffer) => {
    if (forwarded) return;

    buffer = Buffer.concat([buffer, chunk]);
    const sepIndex = buffer.indexOf(HEADER_END);
    if (sepIndex === -1) return;

    const headerText = buffer.slice(0, sepIndex).toString("latin1");
    const contentLength = parseContentLength(headerText);
    if (contentLength === null) {
      forwardRequest(buffer);
      return;
    }

    const totalLength = sepIndex + HEADER_END.length + contentLength;
    if (buffer.length < totalLength) return;

    const fullRequest = buffer.slice(0, totalLength);
    const remainder = buffer.slice(totalLength);
    forwardRequest(injectUserHeader(fullRequest, userId), remainder);
  };

  const forwardRequest = (request: Buffer, remainder?: Buffer) => {
    forwarded = true;
    client.removeListener("data", onData);
    const target = net.connect(targetPort, targetHost, () => {
      target.write(request);
      if (remainder && remainder.length > 0) target.write(remainder);
    });
    pipeBidirectional(client, target);
  };

  client.on("data", onData);
  client.on("error", () => client.destroy());
}

export function registerSessionMcpBridge(
  sessionId: string,
  userId: string,
  targetHost: string,
  targetPort: number,
): void {
  if (sessionBridges.has(sessionId)) return;

  const sockPath = sessionMcpSockPath(sessionId);
  fs.mkdirSync(path.dirname(sockPath), { recursive: true });
  try { fs.unlinkSync(sockPath); } catch { /* ignore */ }

  const state: SessionMcpBridgeState = { server: net.createServer() };
  state.server.on("connection", (client) => {
    handleClientConnection(client, userId, targetHost, targetPort);
  });
  state.server.on("error", (err) => {
    console.error(`[session-mcp-bridge] session=${sessionId} 错误:`, err.message);
  });
  state.server.listen(sockPath, () => {
    console.log(`[session-mcp-bridge] session=${sessionId} user=${userId}: ${sockPath} → ${targetHost}:${targetPort}`);
  });

  sessionBridges.set(sessionId, state);
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
