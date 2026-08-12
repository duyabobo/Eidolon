#!/usr/bin/env node
/**
 * 沙盒内网络桥接器（TCP loopback ↔ Unix socket）。
 *
 * 在 bwrap/sandbox-exec 沙盒内运行，将两个 loopback TCP 端口桥接到本 session 的 Unix socket：
 *   127.0.0.1:$PI_BRIDGE_LLM_PORT ↔ $PI_SOCKS_LLM  → pi-runtime → llm-proxy
 *   127.0.0.1:$PI_BRIDGE_MCP_PORT ↔ $PI_SOCKS_MCP  → pi-runtime → mcp-proxy
 *
 * 纯字节转发，不解析协议，支持 HTTP、SSE 等所有 TCP 协议。
 * 沙盒内 pi 进程通过这两个端口完成 LLM 推理和 MCP 工具调用。
 *
 * 端口默认 9001/8080（Linux bwrap --unshare-net 下每个 session 独立网络命名空间，
 * 固定端口不会跨 session/跟真实服务冲突）。macOS sandbox-exec 没有网络命名空间，
 * pi-session.ts 会通过 PI_BRIDGE_LLM_PORT/PI_BRIDGE_MCP_PORT 注入按 session 动态
 * 分配的端口（见 src/sandbox-ports.ts），避免与真实 llm-proxy/mcp-proxy 及其他并发
 * session 的桥接端口冲突。
 */
"use strict";

const net = require("net");

const LLM_SOCK = process.env.PI_SOCKS_LLM || "/tmp/pi-socks/llm.sock";
const MCP_SOCK = process.env.PI_SOCKS_MCP || "/tmp/pi-socks/mcp.sock";
const LLM_PORT = Number(process.env.PI_BRIDGE_LLM_PORT) || 9001;
const MCP_PORT = Number(process.env.PI_BRIDGE_MCP_PORT) || 8080;

function startBridge(tcpPort, unixSockPath, label) {
  const server = net.createServer((tcpConn) => {
    const unixConn = net.connect(unixSockPath);

    tcpConn.pipe(unixConn);
    unixConn.pipe(tcpConn);

    tcpConn.on("error", () => unixConn.destroy());
    unixConn.on("error", () => tcpConn.destroy());
    tcpConn.on("close", () => unixConn.destroy());
    unixConn.on("close", () => tcpConn.destroy());
  });

  server.on("error", (err) => {
    process.stderr.write(`[sandbox-bridge] ${label} 错误: ${err.message}\n`);
  });

  server.listen(tcpPort, "127.0.0.1", () => {
    process.stderr.write(
      `[sandbox-bridge] ${label}: 127.0.0.1:${tcpPort} → ${unixSockPath}\n`
    );
  });
}

startBridge(LLM_PORT, LLM_SOCK, "LLM");
startBridge(MCP_PORT, MCP_SOCK, "MCP");
