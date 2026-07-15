/**
 * 沙盒 Unix socket 根目录。
 * LLM / MCP 按 session 注册到 sessions/{sessionId}/ 下。
 *
 * 沙盒挂载必须只暴露本 session 目录（tmpfs 覆盖 SOCKS_DIR 后再 ro-bind），
 * 禁止把整棵 SOCKS_DIR 挂进沙盒，否则同机其它 session 的 sock 可被连用。
 */
import fs from "fs";
import path from "path";

export const SOCKS_DIR = "/tmp/pi-socks";

export function sessionSocksDir(sessionId: string): string {
  return path.join(SOCKS_DIR, "sessions", sessionId);
}

export function startSocketBridge(): void {
  fs.mkdirSync(SOCKS_DIR, { recursive: true });
  fs.mkdirSync(path.join(SOCKS_DIR, "sessions"), { recursive: true });
}
