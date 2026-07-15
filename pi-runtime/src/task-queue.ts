/**
 * 基于 Redis Streams Consumer Group 的可靠任务队列。
 *
 * - XREADGROUP 分发新任务
 * - XACK 确认已完成任务
 * - XAUTOCLAIM 回收超时未确认任务
 * - 死信 Stream 保存超过最大重试次数的任务
 */
import Redis from "ioredis";

export interface AgentTask {
  taskId: string;
  taskType: "start" | "message";
  sessionId: string;
  userId: string;
  request: string;
  turnId: string;
  skillIds: string[];
}

interface QueueEntry {
  messageId: string;
  task: AgentTask;
}

export interface TaskProcessResult {
  action: "ack" | "retry" | "dead_letter";
  error?: string;
}

export interface TaskQueueOptions {
  redisUrl: string;
  stream: string;
  group: string;
  consumer: string;
  deadLetterStream: string;
  blockMs: number;
  claimIdleMs: number;
  claimIntervalMs: number;
  readCount: number;
  claimCount: number;
  handleTask: (task: AgentTask) => Promise<TaskProcessResult>;
}

type StreamReply = Array<[string, Array<[string, string[]]>]>;
type AutoClaimReply = [string, Array<[string, string[]]>, string[]];

function fieldsToTask(fields: string[]): AgentTask {
  const values = new Map<string, string>();
  for (let index = 0; index < fields.length; index += 2) {
    values.set(fields[index] ?? "", fields[index + 1] ?? "");
  }

  const taskType = values.get("task_type");
  if (taskType !== "start" && taskType !== "message") {
    throw new Error(`未知任务类型: ${taskType}`);
  }

  const taskId = values.get("task_id");
  const sessionId = values.get("session_id");
  const userId = values.get("user_id");
  const request = values.get("request");
  const turnId = values.get("turn_id");
  if (!taskId || !sessionId || !userId || request == null || !turnId) {
    throw new Error("任务字段不完整");
  }

  let skillIds: string[];
  try {
    const parsed = JSON.parse(values.get("skill_ids") ?? "[]");
    skillIds = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    throw new Error("skill_ids 不是合法 JSON");
  }

  return { taskId, taskType, sessionId, userId, request, turnId, skillIds };
}

function decodeEntries(entries: Array<[string, string[]]>): QueueEntry[] {
  return entries.map(([messageId, fields]) => ({
    messageId,
    task: fieldsToTask(fields),
  }));
}

export class ReliableTaskQueue {
  private readonly client: Redis;
  private running = false;
  private reclaimTimer?: NodeJS.Timeout;

  constructor(private readonly options: TaskQueueOptions) {
    this.client = new Redis(options.redisUrl);
    this.client.on("error", (error) => {
      console.error(`[task-queue] Redis 错误: ${error.message}`);
    });
  }

  async start(): Promise<void> {
    await this.ensureConsumerGroup();
    this.running = true;
    this.reclaimTimer = setInterval(() => {
      this.reclaimTimedOutTasks().catch((error) => {
        console.error(`[task-queue] 超时任务认领失败: ${this.errorMessage(error)}`);
      });
    }, this.options.claimIntervalMs);
    void this.consumeLoop();
    await this.reclaimTimedOutTasks();
    console.log(
      `[task-queue] 已启动 stream=${this.options.stream} group=${this.options.group} consumer=${this.options.consumer}`,
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reclaimTimer) {
      clearInterval(this.reclaimTimer);
      this.reclaimTimer = undefined;
    }
    await this.client.quit();
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.client.xgroup("CREATE", this.options.stream, this.options.group, "0", "MKSTREAM");
      console.log(`[task-queue] 已创建 Consumer Group: ${this.options.group}`);
    } catch (error) {
      if (this.errorMessage(error).includes("BUSYGROUP")) {
        return;
      }
      throw error;
    }
  }

  private async consumeLoop(): Promise<void> {
    while (this.running) {
      try {
        const reply = await this.client.xreadgroup(
          "GROUP",
          this.options.group,
          this.options.consumer,
          "COUNT",
          this.options.readCount,
          "BLOCK",
          this.options.blockMs,
          "STREAMS",
          this.options.stream,
          ">",
        ) as StreamReply | null;
        if (!reply) {
          continue;
        }
        for (const [, entries] of reply) {
          await this.processEntries(decodeEntries(entries));
        }
      } catch (error) {
        if (!this.running) {
          return;
        }
        console.error(`[task-queue] 读取新任务失败: ${this.errorMessage(error)}`);
      }
    }
  }

  private async reclaimTimedOutTasks(): Promise<void> {
    if (!this.running) {
      return;
    }

    const reply = await this.client.xautoclaim(
      this.options.stream,
      this.options.group,
      this.options.consumer,
      this.options.claimIdleMs,
      "0-0",
      "COUNT",
      this.options.claimCount,
    ) as AutoClaimReply;
    const [, entries] = reply;
    if (entries.length > 0) {
      console.warn(`[task-queue] 已认领超时任务 count=${entries.length}`);
      await this.processEntries(decodeEntries(entries));
    }
  }

  private async processEntries(entries: QueueEntry[]): Promise<void> {
    for (const entry of entries) {
      let result: TaskProcessResult;
      try {
        result = await this.options.handleTask(entry.task);
      } catch (error) {
        result = { action: "retry", error: this.errorMessage(error) };
      }

      if (result.action === "ack") {
        await this.client.xack(this.options.stream, this.options.group, entry.messageId);
        continue;
      }
      if (result.action === "dead_letter") {
        await this.writeDeadLetter(entry, result.error ?? "超过最大重试次数");
        await this.client.xack(this.options.stream, this.options.group, entry.messageId);
      }
    }
  }

  private async writeDeadLetter(entry: QueueEntry, error: string): Promise<void> {
    await this.client.xadd(
      this.options.deadLetterStream,
      "*",
      "original_message_id",
      entry.messageId,
      "task_id",
      entry.task.taskId,
      "task_type",
      entry.task.taskType,
      "session_id",
      entry.task.sessionId,
      "turn_id",
      entry.task.turnId,
      "error",
      error,
    );
    console.error(`[task-queue] 任务已写入死信队列: task_id=${entry.task.taskId} error=${error}`);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
