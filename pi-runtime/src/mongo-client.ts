import { MongoClient, Db, Filter, Document } from "mongodb";
import { config } from "./config";

const SESSION_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  // 沙盒因闲置超时被回收，session 仍可重启（区别于用户主动关闭的 COMPLETED）
  IDLE: "IDLE",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

let client: MongoClient | null = null;

export function getDb(): Db {
  if (!client) throw new Error("MongoDB 未连接，请先调用 connect()");
  return client.db(config.mongo.db);
}

export async function connect(): Promise<void> {
  client = new MongoClient(config.mongo.uri);
  await client.connect();
  console.log(`[mongo] 已连接: ${config.mongo.uri}`);
}

export async function disconnect(): Promise<void> {
  await client?.close();
  client = null;
  console.log("[mongo] 连接已关闭");
}

export async function updateSessionStatus(
  sessionId: string,
  status: SessionStatus,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const now = new Date();
  const update: Record<string, unknown> = { status, ...extra };

  if (status === SESSION_STATUS.RUNNING) {
    update.started_at = now;
  } else if (status === SESSION_STATUS.COMPLETED || status === SESSION_STATUS.FAILED) {
    update.completed_at = now;
  }

  await getDb()
    .collection("sessions")
    .updateOne({ _id: sessionId } as unknown as Filter<Document>, { $set: update });

  console.log(`[mongo] session ${sessionId} 状态更新 -> ${status}`);
}

/**
 * 批量写入事件到 events_snapshot。
 * 使用 $push + $each 一次 updateOne，避免 N 次 DB 写入。
 */
export async function appendEventSnapshot(
  sessionId: string,
  events: Array<Record<string, unknown>>
): Promise<void> {
  if (events.length === 0) return;
  await getDb()
    .collection("sessions")
    .updateOne(
      { _id: sessionId } as unknown as Filter<Document>,
      { $push: { events_snapshot: { $each: events } } } as unknown as Filter<Document>
    );
}

// ── 可靠任务状态 ──────────────────────────────────────────────────────────────

interface TaskPayload {
  taskId: string;
  taskType: "start" | "message";
  sessionId: string;
  userId: string;
  request: string;
  turnId: string;
  skillIds: string[];
}

export type TaskClaimResult = "execute" | "completed";

/**
 * 持久化任务完成状态，防止 Redis Stream 至少一次投递导致已完成 task_id
 * 再次触发 LLM/MCP 调用。
 */
export async function claimTaskExecution(
  task: TaskPayload,
  consumerId: string,
): Promise<TaskClaimResult> {
  const collection = getDb().collection("agent_tasks");
  const existing = await collection.findOne({ _id: task.taskId } as unknown as Filter<Document>);
  if (existing?.status === "COMPLETED") {
    return "completed";
  }

  await collection.updateOne(
    { _id: task.taskId } as unknown as Filter<Document>,
    {
      $setOnInsert: {
        task_type: task.taskType,
        session_id: task.sessionId,
        user_id: task.userId,
        request: task.request,
        turn_id: task.turnId,
        skill_ids: task.skillIds,
        created_at: new Date(),
        retry_count: 0,
      },
      $set: {
        status: "RUNNING",
        consumer_id: consumerId,
        started_at: new Date(),
        updated_at: new Date(),
      },
    },
    { upsert: true },
  );
  return "execute";
}

export async function completeTask(taskId: string): Promise<void> {
  await getDb().collection("agent_tasks").updateOne(
    { _id: taskId } as unknown as Filter<Document>,
    {
      $set: {
        status: "COMPLETED",
        completed_at: new Date(),
        updated_at: new Date(),
      },
    },
  );
}

export async function recordTaskFailure(taskId: string, error: string): Promise<number> {
  const result = await getDb().collection("agent_tasks").findOneAndUpdate(
    { _id: taskId } as unknown as Filter<Document>,
    {
      $set: {
        status: "PENDING",
        last_error: error,
        updated_at: new Date(),
      },
      $inc: { retry_count: 1 },
    },
    { returnDocument: "after" },
  );
  return Number(result?.retry_count ?? 1);
}

// ── 启动恢复 ──────────────────────────────────────────────────────────────────

export interface OrphanedSession {
  session_id: string;
  user_id: string;
  request: string;
  skill_ids: string[];
  status: string;
}

/**
 * 查找所有处于 RUNNING 或 PENDING 状态的 session。
 * pi-runtime 启动时调用，用于恢复因重启而丢失的孤儿任务。
 */
export async function findOrphanedSessions(): Promise<OrphanedSession[]> {
  const docs = await getDb()
    .collection("sessions")
    .find({ status: { $in: [SESSION_STATUS.RUNNING, SESSION_STATUS.PENDING] } } as unknown as Filter<Document>)
    .toArray();

  return docs.map((doc) => ({
    session_id: String(doc._id),
    user_id: String(doc.user_id),
    request: String(doc.request ?? ""),
    skill_ids: Array.isArray(doc.skill_ids) ? (doc.skill_ids as string[]) : [],
    status: String(doc.status ?? ""),
  }));
}

// Skill 由文件系统管理（/data/sandboxes/global/skills/ 和 users/{uid}/skills/）
// pi-runtime 直接使用文件路径，不再从 MongoDB 读取 skill 内容
