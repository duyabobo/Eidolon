/**
 * 按 session 维度的 LLM HTTP 桥：在转发到 llm-proxy 前注入追踪 Header。
 *
 *   X-Session-Id   → session_id
 *   X-Question-Id  → question_id（对应当前 turn）
 *
 * pi 沙盒内 bridge.js 连接 session 专属 Unix socket，本模块负责解析 HTTP 请求并注入 Header。
 */
import fs from "fs";
import net from "net";
import path from "path";

import { sessionSocksDir } from "./socket-bridge";

const HEADER_END = Buffer.from("\r\n\r\n");
const CRLF = "\r\n";
// 请求头/请求体上限：防止无 \r\n\r\n 终止符或超大声明时无限累积缓冲耗尽内存
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 50 * 1024 * 1024;

interface SessionBridgeState {
  server: net.Server;
  currentQuestionId: string | null;
}

const sessionBridges = new Map<string, SessionBridgeState>();

function sessionLlmSockPath(sessionId: string): string {
  return path.join(sessionSocksDir(sessionId), "llm.sock");
}

function parseContentLength(headerText: string): number | null {
  const match = headerText.match(/^content-length:\s*(\d+)/im);
  return match ? Number.parseInt(match[1], 10) : null;
}

function injectTracingHeaders(
  requestBuffer: Buffer,
  sessionId: string,
  questionId: string | null,
): Buffer {
  const text = requestBuffer.toString("latin1");
  const sep = text.indexOf("\r\n\r\n");
  if (sep === -1) {
    return requestBuffer;
  }

  const head = text.slice(0, sep);
  const body = text.slice(sep + 4);
  const lines = head.split("\r\n");
  const keptHeaders = lines.slice(1).filter((line) => {
    const lower = line.toLowerCase();
    return !lower.startsWith("x-session-id:") && !lower.startsWith("x-question-id:");
  });

  keptHeaders.push(`X-Session-Id: ${sessionId}`);
  if (questionId) {
    keptHeaders.push(`X-Question-Id: ${questionId}`);
  }

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
  sessionId: string,
  targetHost: string,
  targetPort: number,
  getQuestionId: () => string | null,
): void {
  let buffer = Buffer.alloc(0);
  let forwarded = false;

  const onData = (chunk: Buffer) => {
    if (forwarded) {
      return;
    }

    buffer = Buffer.concat([buffer, chunk]);
    const sepIndex = buffer.indexOf(HEADER_END);
    if (sepIndex === -1) {
      if (buffer.length > MAX_HEADER_BYTES) {
        client.destroy();
      }
      return;
    }

    const headerText = buffer.slice(0, sepIndex).toString("latin1");
    const contentLength = parseContentLength(headerText);
    if (contentLength === null) {
      forwardRequest(buffer);
      return;
    }

    if (contentLength > MAX_BODY_BYTES) {
      client.destroy();
      return;
    }

    const totalLength = sepIndex + HEADER_END.length + contentLength;
    if (buffer.length < totalLength) {
      return;
    }

    const fullRequest = buffer.slice(0, totalLength);
    const remainder = buffer.slice(totalLength);
    const modified = injectTracingHeaders(fullRequest, sessionId, getQuestionId());
    forwardRequest(modified, remainder);
  };

  const forwardRequest = (request: Buffer, remainder?: Buffer) => {
    forwarded = true;
    client.removeListener("data", onData);

    const target = net.connect(targetPort, targetHost, () => {
      target.write(request);
      if (remainder && remainder.length > 0) {
        target.write(remainder);
      }
    });
    pipeBidirectional(client, target);
  };

  client.on("data", onData);
  client.on("error", () => client.destroy());
}

export function registerSessionLlmBridge(
  sessionId: string,
  targetHost: string,
  targetPort: number,
): void {
  if (sessionBridges.has(sessionId)) {
    return;
  }

  const sockPath = sessionLlmSockPath(sessionId);
  fs.mkdirSync(path.dirname(sockPath), { recursive: true });
  try {
    fs.unlinkSync(sockPath);
  } catch {
    // 不存在则忽略
  }

  const state: SessionBridgeState = {
    currentQuestionId: null,
    server: net.createServer(),
  };

  state.server.on("connection", (client) => {
    handleClientConnection(
      client,
      sessionId,
      targetHost,
      targetPort,
      () => state.currentQuestionId,
    );
  });

  state.server.on("error", (err) => {
    console.error(`[session-llm-bridge] session=${sessionId} 错误:`, err.message);
  });

  state.server.listen(sockPath, () => {
    console.log(
      `[session-llm-bridge] session=${sessionId}: ${sockPath} → ${targetHost}:${targetPort}`,
    );
  });

  sessionBridges.set(sessionId, state);
}

export function setSessionQuestionId(sessionId: string, questionId: string): void {
  const state = sessionBridges.get(sessionId);
  if (!state) {
    console.warn(`[session-llm-bridge] session=${sessionId}: bridge 未注册，跳过 question_id 设置`);
    return;
  }
  state.currentQuestionId = questionId;
}

export function unregisterSessionLlmBridge(sessionId: string): void {
  const state = sessionBridges.get(sessionId);
  if (!state) {
    return;
  }

  state.server.close();
  sessionBridges.delete(sessionId);

  const sockPath = sessionLlmSockPath(sessionId);
  try {
    fs.unlinkSync(sockPath);
  } catch {
    // 忽略
  }
  console.log(`[session-llm-bridge] session=${sessionId}: bridge 已关闭`);
}

export function sessionLlmSockForSandbox(sessionId: string): string {
  return sessionLlmSockPath(sessionId);
}
