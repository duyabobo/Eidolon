import Redis from "ioredis";
import { appendEventSnapshot } from "./mongo-client";
import { config } from "./config";

// Redis Stream key 模板（与 gateway 保持一致）
// session 级：session:{sessionId}:stream（向后兼容）
// turn 级：session:{sessionId}:turn:{turnId}:stream（多轮对话）
const STREAM_KEY_TPL = "session:{sessionId}:stream";
const TURN_STREAM_KEY_TPL = "session:{sessionId}:turn:{turnId}:stream";

function buildStreamKey(sessionId: string, turnId?: string): string {
  if (turnId) {
    return TURN_STREAM_KEY_TPL.replace("{sessionId}", sessionId).replace("{turnId}", turnId);
  }
  return STREAM_KEY_TPL.replace("{sessionId}", sessionId);
}

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
// 在“逐 token 写库”（拖垮 Mongo）与“只在轮次结束写库”（进程意外死亡时整轮丢失）之间取平衡。
const SNAPSHOT_FLUSH_BATCH_SIZE = 20;
const SNAPSHOT_FLUSH_INTERVAL_MS = 2000;

export class SessionOutputStream {
  private readonly streamKey: string;
  private pushCount = 0;
  private readonly pendingSnapshot: Array<Record<string, string>> = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly sessionId: string,
    private readonly turnId?: string   // 多轮对话时指定轮次，生成 turn 级 stream key
  ) {
    this.streamKey = buildStreamKey(sessionId, turnId);
  }

  async push(event: OutputEvent): Promise<void> {
    const msgId = await this.redis.xadd(
      this.streamKey,
      "*",
      "event_type",
      event.event_type,
      "content",
      event.content
    );
    this.pushCount++;
    if (this.pushCount === 1) {
      console.log(`[stream] session ${this.sessionId}: 首条事件写入 Redis Stream key=${this.streamKey} msg_id=${msgId} event_type=${event.event_type}`);
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
    await this.redis.del(`session:${this.sessionId}:active_turn`).catch(() => {});
  }

  async pushError(message: string): Promise<void> {
    this._cancelScheduledFlush();
    await this._flushSnapshot();
    await this.push({ event_type: "error", content: message });
    console.error(`[stream] session ${this.sessionId}: error 事件已推送: ${message}`);
    await this.redis.del(`session:${this.sessionId}:active_turn`).catch(() => {});
  }

  /** 用户中断：立即将已生成内容写入 MongoDB，并通知前端结束 */
  async pushCancelled(): Promise<void> {
    this._cancelScheduledFlush();
    await this._flushSnapshot();
    await this.redis.xadd(this.streamKey, "*", "event_type", "cancelled", "content", "");
    await this.redis.xadd(this.streamKey, "*", "event_type", "done", "content", "");
    this.pushCount += 2;
    console.log(`[stream] session ${this.sessionId}: 用户中断，partial snapshot 已入库`);
    await this.redis.del(`session:${this.sessionId}:active_turn`).catch(() => {});
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

  /**
   * 将内存中积累的事件批量写入 MongoDB。
   * 使用 $push + $each 一条 updateOne，避免 N 次 DB 写入；
   * 用 splice 先取出待写批次，避免与写入期间新到达的事件产生竞态。
   */
  private async _flushSnapshot(): Promise<void> {
    if (this.pendingSnapshot.length === 0) return;
    const batch = this.pendingSnapshot.splice(0, this.pendingSnapshot.length);
    await appendEventSnapshot(this.sessionId, batch);
    console.log(`[stream] session ${this.sessionId}: snapshot 已写入 MongoDB，共 ${batch.length} 条事件`);
  }

  // 设置 Stream 自动过期（任务完成后 1 小时清理）
  async expire(seconds: number = 3600): Promise<void> {
    await this.redis.expire(this.streamKey, seconds);
    console.log(`[stream] session ${this.sessionId}: Stream 已设置过期 TTL=${seconds}s`);
  }
}

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) throw new Error("Redis 未连接，请先调用 connectRedis()");
  return redisClient;
}

export async function connectRedis(): Promise<Redis> {
  redisClient = new Redis(config.redis.url);
  redisClient.on("error", (err) => console.error("[redis] 连接错误:", err));
  console.log(`[redis] 已连接: ${config.redis.url}`);
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  await redisClient?.quit();
  redisClient = null;
}
