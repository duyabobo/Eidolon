// ── 类型定义 ─────────────────────────────────────────────────────────────────
import { apiFetch } from "./http";
// ── 工具函数 ─────────────────────────────────────────────────────────────────
/** 解析 FastAPI 错误响应（detail 可能是字符串或数组） */
function parseErrorDetail(detail) {
    if (typeof detail === "string")
        return detail;
    if (Array.isArray(detail)) {
        return detail.map((d) => d.msg ?? String(d)).join("; ");
    }
    return String(detail);
}
async function throwIfNotOk(resp) {
    if (resp.ok)
        return;
    const body = await resp.json().catch(() => ({}));
    const detail = body.detail;
    throw new Error(detail ? parseErrorDetail(detail) : `HTTP ${resp.status}`);
}
// ── Session API ───────────────────────────────────────────────────────────────
/** 创建新 session（打开新 chat 窗口 + 发送第一条消息） */
export async function createSession(userId, request, turnId, skillIds = []) {
    const resp = await apiFetch("/sessions", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, request, turn_id: turnId, skill_ids: skillIds }),
    });
    await throwIfNotOk(resp);
    return resp.json();
}
/** 向已有 session 发送新消息（多轮对话） */
export async function sendMessage(sessionId, request, turnId, skillIds = []) {
    const resp = await apiFetch(`/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ request, turn_id: turnId, skill_ids: skillIds }),
    });
    await throwIfNotOk(resp);
    return resp.json();
}
/** 关闭 session（关闭 chat 窗口，销毁 pi 进程和沙盒） */
export async function closeSession(sessionId) {
    await apiFetch(`/sessions/${sessionId}`, { method: "DELETE" });
}
/** 中断指定轮次的生成任务（已产出内容会立即入库） */
export async function cancelTurn(sessionId, turnId) {
    const resp = await apiFetch(`/sessions/${sessionId}/turns/${turnId}/cancel`, { method: "POST" });
    await throwIfNotOk(resp);
}
/** 获取用户最近的 session 列表（每条 = 一个 chat 窗口） */
export async function getRecentSessions(userId, limit = 20) {
    const resp = await apiFetch(`/sessions?user_id=${encodeURIComponent(userId)}&limit=${limit}`);
    if (!resp.ok)
        return [];
    return resp.json();
}
/** 获取 session 当前进行中的 turn_id（无则 null） */
export async function getActiveTurn(sessionId) {
    const resp = await apiFetch(`/sessions/${sessionId}/active_turn`);
    if (!resp.ok)
        return null;
    const body = (await resp.json());
    return body.turn_id;
}
/** 获取 session 详情（含 events_snapshot，用于重建消息） */
export async function getSessionDetail(sessionId) {
    const resp = await apiFetch(`/sessions/${sessionId}`);
    if (!resp.ok)
        return null;
    return resp.json();
}
// ── SSE 流 ────────────────────────────────────────────────────────────────────
/**
 * 订阅指定轮次的 SSE 输出流。
 * 返回 close 函数，调用后断开连接。
 */
export function streamTurn(sessionId, turnId, onEvent, onDone, onError, lastSeq = "0") {
    const qs = lastSeq !== "0" ? `?last_seq=${encodeURIComponent(lastSeq)}` : "";
    const es = new EventSource(`/sessions/${sessionId}/turns/${turnId}/stream${qs}`);
    let closed = false;
    const close = () => {
        if (closed)
            return;
        closed = true;
        es.close();
    };
    const handlers = {
        token: (e) => onEvent({ event: "token", data: e.data }),
        thinking: (e) => onEvent({ event: "thinking", data: e.data }),
        tool_call: (e) => onEvent({ event: "tool_call", data: e.data }),
        tool_result: (e) => onEvent({ event: "tool_result", data: e.data }),
        done: () => { onDone(); close(); },
        cancelled: () => { onDone(); close(); },
        error: (e) => { onError(e.data || "执行出错"); close(); },
        heartbeat: () => { },
    };
    Object.entries(handlers).forEach(([ev, fn]) => es.addEventListener(ev, fn));
    es.onerror = () => {
        if (closed)
            return;
        onError("SSE 连接中断");
        close();
    };
    return () => close();
}
