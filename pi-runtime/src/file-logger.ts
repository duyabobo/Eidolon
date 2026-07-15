/**
 * 将 console 输出同步落到 /app/logs（与 Python 服务 pi_shared.setup_logging 对齐）。
 * 按天滚动，保留 LOG_RETENTION_DAYS 天；不替换 console 语义，仅额外写文件。
 */
import fs from "node:fs";
import path from "node:path";

const LOG_DIR = process.env.LOG_DIR ?? "/app/logs";
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS ?? 7);
const SERVICE_NAME = "pi-runtime";

type ConsoleMethod = "log" | "info" | "warn" | "error";

function dateStamp(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.stack ?? arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function pruneOldLogs(dir: string): void {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(`${SERVICE_NAME}.log`)) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    } catch {
      // 清理失败不影响主流程
    }
  }
}

export function setupFileLogging(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  pruneOldLogs(LOG_DIR);

  let currentStamp = dateStamp();
  let stream = fs.createWriteStream(path.join(LOG_DIR, `${SERVICE_NAME}.log.${currentStamp}`), {
    flags: "a",
  });

  const ensureStream = (): fs.WriteStream => {
    const stamp = dateStamp();
    if (stamp === currentStamp) return stream;
    stream.end();
    currentStamp = stamp;
    pruneOldLogs(LOG_DIR);
    stream = fs.createWriteStream(path.join(LOG_DIR, `${SERVICE_NAME}.log.${currentStamp}`), {
      flags: "a",
    });
    return stream;
  };

  const methods: ConsoleMethod[] = ["log", "info", "warn", "error"];
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      const line = `${new Date().toISOString()} [${method.toUpperCase()}] ${formatArgs(args)}\n`;
      ensureStream().write(line);
    };
  }
}
