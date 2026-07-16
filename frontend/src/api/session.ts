// ── 类型定义 ─────────────────────────────────────────────────────────────────

import { apiFetch } from "./http";

export interface CreateSessionResp {
  session_id: string;
  status: string;
}

export interface SendMessageResp {
  session_id: string;
  turn_id: string;
}

/** session 列表摘要（一个 session = 一个 chat 窗口） */
export interface SessionSummary {
  session_id: string;
  status: string;
  request: string;       // 第一条消息，作为标题
  created_at: string;
  completed_at: string | null;
}

/** session 详情（含 events_snapshot，用于重建历史消息） */
export interface SessionDetail {
  _id: string;
  status: string;
  request: string;
  events_snapshot: Array<{ event_type: string; content: string; ts?: number | string }>;
  created_at: string;
}

export interface StreamEvent {
  event: string;
  data: string;
  id?: string;
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

/** 解析 FastAPI 错误响应（detail 可能是字符串或数组） */
function parseErrorDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d: { msg?: string }) => d.msg ?? String(d)).join("; ");
  }
  return String(detail);
}

async function throwIfNotOk(resp: Response): Promise<void> {
  if (resp.ok) return;
  const body = await resp.json().catch(() => ({}));
  const detail = (body as { detail?: unknown }).detail;
  throw new Error(detail ? parseErrorDetail(detail) : `HTTP ${resp.status}`);
}

// ── Session API ───────────────────────────────────────────────────────────────

/** 创建新 session（打开新 chat 窗口 + 发送第一条消息） */
export async function createSession(
  userId: string,
  request: string,
  turnId: string,
  skillIds: string[] = [],
  deferStart = false,
): Promise<CreateSessionResp & { deferred?: boolean }> {
  const resp = await apiFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      request,
      turn_id: turnId,
      skill_ids: skillIds,
      defer_start: deferStart,
    }),
    // 关页/刷新时尽量仍完成落库，保证历史列表能看到新会话
    keepalive: true,
  });
  await throwIfNotOk(resp);
  return resp.json();
}

/** 向已有 session 发送新消息（多轮对话） */
export async function sendMessage(
  sessionId: string,
  request: string,
  turnId: string,
  skillIds: string[] = [],
): Promise<SendMessageResp> {
  const resp = await apiFetch(`/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ request, turn_id: turnId, skill_ids: skillIds }),
  });
  await throwIfNotOk(resp);
  return resp.json();
}

/** 关闭 session（关闭 chat 窗口，销毁 pi 进程和沙盒） */
export async function closeSession(sessionId: string): Promise<void> {
  await apiFetch(`/sessions/${sessionId}`, { method: "DELETE" });
}

/** 中断指定轮次的生成任务（已产出内容会立即入库） */
export async function cancelTurn(sessionId: string, turnId: string): Promise<void> {
  const resp = await apiFetch(`/sessions/${sessionId}/turns/${turnId}/cancel`, { method: "POST" });
  await throwIfNotOk(resp);
}

/** 获取用户最近的 session 列表（每条 = 一个 chat 窗口） */
export async function getRecentSessions(userId: string, limit = 20): Promise<SessionSummary[]> {
  const resp = await apiFetch(`/sessions?user_id=${encodeURIComponent(userId)}&limit=${limit}`);
  if (!resp.ok) return [];
  return resp.json();
}

/** 获取 session 当前进行中的 turn_id（无则 null） */
export async function getActiveTurn(sessionId: string): Promise<string | null> {
  const resp = await apiFetch(`/sessions/${sessionId}/active_turn`);
  if (!resp.ok) return null;
  const body = (await resp.json()) as { turn_id: string | null };
  return body.turn_id;
}

/** 获取 session 详情（含 events_snapshot，用于重建消息） */
export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const resp = await apiFetch(`/sessions/${sessionId}`);
  if (!resp.ok) return null;
  return resp.json();
}

// ── SSE 流 ────────────────────────────────────────────────────────────────────

/**
 * 订阅指定轮次的 SSE 输出流。
 * 返回 close 函数，调用后断开连接。
 */
export function streamTurn(
  sessionId: string,
  turnId: string,
  onEvent: (event: StreamEvent) => void,
  onDone: () => void,
  onError: (msg: string) => void,
  lastSeq = "0",
): () => void {
  const qs = lastSeq !== "0" ? `?last_seq=${encodeURIComponent(lastSeq)}` : "";
  const es = new EventSource(`/sessions/${sessionId}/turns/${turnId}/stream${qs}`);
  let closed = false;
  let sawEvent = false;

  const close = () => {
    if (closed) return;
    closed = true;
    es.close();
  };

  const handlers: Record<string, (e: MessageEvent) => void> = {
    token:       (e) => { sawEvent = true; onEvent({ event: "token",       data: e.data }); },
    thinking:    (e) => { sawEvent = true; onEvent({ event: "thinking",    data: e.data }); },
    tool_call:   (e) => { sawEvent = true; onEvent({ event: "tool_call",   data: e.data }); },
    tool_result: (e) => { sawEvent = true; onEvent({ event: "tool_result", data: e.data }); },
    done:        ()  => { sawEvent = true; onDone(); close(); },
    cancelled:   ()  => { sawEvent = true; onDone(); close(); },
    error:       (e) => { sawEvent = true; onError(e.data || "执行出错"); close(); },
    heartbeat:   ()  => {},
  };

  Object.entries(handlers).forEach(([ev, fn]) => es.addEventListener(ev, fn));
  // EventSource 在自动重连时也会触发 error；仅在真正 CLOSED 时才结束，避免误杀流式
  es.onerror = () => {
    if (closed) return;
    if (es.readyState === EventSource.CLOSED) {
      onError(sawEvent ? "SSE 连接中断" : "SSE 连接失败");
      close();
    }
  };

  return () => close();
}
