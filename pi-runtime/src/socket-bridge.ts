/**
 * 沙盒 Unix socket 根目录。
 * LLM / MCP 按 session 注册到 sessions/{sessionId}/ 下。
 */
import fs from "fs";

export const SOCKS_DIR = "/tmp/pi-socks";

export function startSocketBridge(): void {
  fs.mkdirSync(SOCKS_DIR, { recursive: true });
  fs.mkdirSync(`${SOCKS_DIR}/sessions`, { recursive: true });
}
