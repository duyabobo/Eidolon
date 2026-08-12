/**
 * 替代原基于 Redis Stream 的实现：每个事件即时以 HTTP 推送给 gateway-sse
 * （gateway-sse 落 SQLite `turn_events` 表 + 唤醒挂起的 SSE 连接，语义等价于原 XADD），
 * 同时按批次把用户可见事件 flush 到 gateway 的 events_snapshot（断线重连历史回放用）。
 */
import { appendEventSnapshot } from "./gateway-client";
import { config } from "./config";

export type EventType =
  | "token"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "final_result"
  | "assistant_file"
  | "done"
  | "error"
  | "cancelled";

export interface OutputEvent {
  event_type: EventType;
  content: string;
}

// snapshot 批量落库阈值：达到条数或超过等待时长即触发一次 flush，
// 在“逐 token 写库”（拖垮 gateway/SQLite）与“只在轮次结束写库”（进程意外死亡时整轮丢失）之间取平衡。
const SNAPSHOT_FLUSH_BATCH_SIZE = 20;
const SNAPSHOT_FLUSH_INTERVAL_MS = 2000;

export class SessionOutputStream {
  private pushCount = 0;
  private readonly pendingSnapshot: Array<Record<string, string>> = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly turnId: string,
  ) {}

  async push(event: OutputEvent): Promise<void> {
    await this._publishToSse(event);
    this.pushCount++;
    if (this.pushCount === 1) {
      console.log(
        `[stream] session ${this.sessionId} turn ${this.turnId}: 首条事件已推送 event_type=${event.event_type}`,
      );
    }
    // 将用户可见的事件（token/tool_call/tool_result）加入 snapshot 缓冲
    // done/error 由 pushDone/pushError 单独处理，避免重复写入
    if (event.event_type !== "done" && event.event_type !== "error") {
      this.pendingSnapshot.push({
        event_type: event.event_type,
        content: event.content,
        ts: String(Date.now()),
      });
      this._scheduleSnapshotFlush();
    }
  }

  async pushDone(): Promise<void> {
    this._cancelScheduledFlush();
    await this._flushSnapshot();
    await this.push({ event_type: "done", content: "" });
    console.log(`[stream] session ${this.sessionId}: done 事件已推送，累计 ${this.pushCount} 条`);
  }

  async pushError(message: string): Promise<void> {
    this._cancelScheduledFlush();
    await this._flushSnapshot();
    await this.push({ event_type: "error", content: message });
    console.error(`[stream] session ${this.sessionId}: error 事件已推送: ${message}`);
  }

  /** 用户中断：立即将已生成内容写入 gateway，并通知前端结束 */
  async pushCancelled(): Promise<void> {
    this._cancelScheduledFlush();
    await this._flushSnapshot();
    await this._publishToSse({ event_type: "cancelled", content: "" });
    await this._publishToSse({ event_type: "done", content: "" });
    this.pushCount += 2;
    console.log(`[stream] session ${this.sessionId}: 用户中断，partial snapshot 已入库`);
  }

  private async _publishToSse(event: OutputEvent): Promise<void> {
    const url = `${config.gatewaySse.baseUrl}/internal/events`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: this.sessionId,
          turn_id: this.turnId,
          event_type: event.event_type,
          content: event.content,
        }),
      });
      if (!res.ok) {
        console.error(`[stream] session ${this.sessionId}: 推送事件到 gateway-sse 失败 status=${res.status}`);
      }
    } catch (err) {
      console.error(`[stream] session ${this.sessionId}: 推送事件到 gateway-sse 异常:`, err);
    }
  }

  /**
   * 达到批量阈值时立即 flush，否则安排一个定时 flush，
   * 保证进程意外退出（如 pi-runtime 自身被 OOM/崩溃）时最多丢失一个批次窗口内的内容。
   */
  private _scheduleSnapshotFlush(): void {
    if (this.pendingSnapshot.length >= SNAPSHOT_FLUSH_BATCH_SIZE) {
      this._cancelScheduledFlush();
      this._flushSnapshot().catch((err) => {
        console.error(`[stream] session ${this.sessionId}: 批量 flush 失败:`, err);
      });
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this._flushSnapshot().catch((err) => {
        console.error(`[stream] session ${this.sessionId}: 定时 flush 失败:`, err);
      });
    }, SNAPSHOT_FLUSH_INTERVAL_MS);
  }

  private _cancelScheduledFlush(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private async _flushSnapshot(): Promise<void> {
    if (this.pendingSnapshot.length === 0) return;
    const batch = this.pendingSnapshot.splice(0, this.pendingSnapshot.length);
    try {
      await appendEventSnapshot(this.sessionId, batch);
      console.log(`[stream] session ${this.sessionId}: snapshot 已写入 gateway，共 ${batch.length} 条事件`);
    } catch (err) {
      console.error(`[stream] session ${this.sessionId}: snapshot 写入 gateway 失败:`, err);
    }
  }
}
