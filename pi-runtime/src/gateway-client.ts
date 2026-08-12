/**
 * 替代原 mongo-client.ts：session 状态与事件快照不再直接写 MongoDB，
 * 而是以本机 HTTP 调用 gateway 的内部接口，由 gateway 统一落本地 SQLite
 * （与 gateway 自身的 session CRUD 共用同一份数据，避免双写两套存储）。
 */
import { config } from "./config";

export type SessionStatus = "PENDING" | "RUNNING" | "IDLE" | "COMPLETED" | "FAILED";

async function postJson(path: string, body: unknown): Promise<void> {
  const url = `${config.gateway.baseUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`gateway 调用失败: POST ${url} status=${res.status}`);
  }
}

export async function updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
  await postJson(`/internal/sessions/${sessionId}/status`, { status });
  console.log(`[gateway-client] session ${sessionId} 状态更新 -> ${status}`);
}

/** 批量写入事件到 events_snapshot，供断线重连回放（gateway 侧一次 SELECT + 一次 UPDATE）。 */
export async function appendEventSnapshot(
  sessionId: string,
  events: Array<Record<string, unknown>>,
): Promise<void> {
  if (events.length === 0) return;
  await postJson(`/internal/sessions/${sessionId}/events`, { events });
}
