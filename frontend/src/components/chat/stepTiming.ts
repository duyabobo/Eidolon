import type { Message } from "../../context/ChatSessionContext";

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** 单条消息的耗时（ms），streaming 时用 now 作为结束时间 */
export function messageDuration(msg: Message, now = Date.now()): number | null {
  if (!msg.startedAt) return null;
  const end = msg.endedAt ?? (msg.isStreaming ? now : null);
  if (end === null) return null;
  return Math.max(0, end - msg.startedAt);
}

/** 工具调用整段耗时：从 call 到 result 结束 */
export function toolStepDuration(call: Message, result?: Message, now = Date.now()): number | null {
  if (!call.startedAt) return null;
  const end = result?.endedAt
    ?? result?.startedAt
    ?? call.endedAt
    ?? ((call.isStreaming || result?.isStreaming) ? now : null);
  if (end === null) return null;
  return Math.max(0, end - call.startedAt);
}

export function isStepLive(...msgs: Message[]): boolean {
  return msgs.some((m) => m.isStreaming || (m.startedAt && !m.endedAt));
}
