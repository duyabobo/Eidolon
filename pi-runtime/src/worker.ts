/**
 * pi-runtime 主入口：订阅 Redis Pub/Sub 任务频道，
 * 管理长生命周期 session（一个 chat 窗口 = 一个 session = 一个 pi 进程）。
 *
 * Session 生命周期：
 *   sessions:new / sessions:{instanceId}:new  → 创建新 session，启动 pi 进程
 *   sessions:{sessionId}:message              → 向已有 session 发送新消息（新轮次）
 *   sessions:{sessionId}:close               → 关闭 session，销毁 pi 进程和沙盒
 *
 * Sticky Session 机制：
 *   pi 进程持续运行期间，workspace 文件保留，pi 维护完整对话历史，
 *   无需外部传 context 字段。
 */
import Redis from "ioredis";
import os from "os";
import { join } from "path";
import { config } from "./config";
import {
  claimTaskExecution,
  completeTask,
  connect as connectMongo,
  disconnect as disconnectMongo,
  recordTaskFailure,
  updateSessionStatus,
} from "./mongo-client";
import { connectRedis, disconnectRedis, getRedis, SessionOutputStream } from "./output-stream";
import { createSandbox, destroySandbox } from "./sandbox";
import { startPiSession, PiSessionHandle } from "./pi-session";
import { startSocketBridge } from "./socket-bridge";
import {
  registerSessionLlmBridge,
  setSessionQuestionId,
  unregisterSessionLlmBridge,
} from "./session-llm-bridge";
import {
  registerSessionMcpBridge,
  unregisterSessionMcpBridge,
} from "./session-mcp-bridge";
import { resolveMcpServersForSkills } from "./skill-mcp";
import { computeSkillContentFingerprint } from "./skill-reload";
import { warmMcpCache } from "./mcp-warmup";
import { AgentTask, ReliableTaskQueue, TaskProcessResult } from "./task-queue";

// ── 消息类型定义 ──────────────────────────────────────────────────────────────

interface NewSessionPayload {
  session_id: string;
  user_id: string;
  request: string;      // 第一条消息
  turn_id: string;      // 第一个轮次 ID
  skill_ids: string[];
}

interface NewMessagePayload {
  session_id: string;
  user_id: string;
  request: string;
  turn_id: string;      // 本轮次 ID（gateway 生成，用于 Redis Stream key）
  skill_ids: string[];
}

// ── 运行中的 session 状态 ─────────────────────────────────────────────────────

interface RunningSession {
  sessionId: string;
  userId: string;
  piHandle: PiSessionHandle;
  skillIds: string[];
  /** 当前 skill 文件内容指纹，用于检测同 skill 的内容热更新 */
  skillContentFingerprint: string;
  closeSubscriber: Redis;       // 订阅 sessions:{sessionId}:close
  cancelSubscriber: Redis;      // 订阅 sessions:{sessionId}:cancel
  inactivityTimer: NodeJS.Timeout;
  startedAt: number;
  activeTurnId?: string;
  activeTurnStream?: SessionOutputStream;
  /** 串行化同一 session 的轮次，避免 recovery 与业务消息并发抢 activeTurn */
  turnChain: Promise<void>;
}

// session 闲置超时（30 分钟无新消息自动关闭）
const SESSION_INACTIVITY_MS = 30 * 60_000;
const ACTIVE_TURN_TTL_SECONDS = 3600;
const TASK_LOCK_KEY_TPL = "agent:task:{taskId}:lock";

function skillIdsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

function buildSkillRoots(userId: string): { globalSkillsRoot: string; userSkillsRoot: string } {
  return {
    globalSkillsRoot: join(config.sandbox.root, "global", "skills"),
    userSkillsRoot: join(config.sandbox.root, "users", userId, "skills"),
  };
}

async function computeSessionSkillFingerprint(userId: string, skillIds: string[]): Promise<string> {
  const roots = buildSkillRoots(userId);
  return computeSkillContentFingerprint({
    skillIds,
    globalSkillsRoot: roots.globalSkillsRoot,
    userSkillsRoot: roots.userSkillsRoot,
  });
}

async function refreshSkillContentFingerprint(running: RunningSession): Promise<void> {
  running.skillContentFingerprint = await computeSessionSkillFingerprint(running.userId, running.skillIds);
}

const runningSessions = new Map<string, RunningSession>();
/** 防止同一 session 并发 startAndRegisterSession 拉起多个 pi 进程 */
const sessionStartGates = new Map<string, Promise<RunningSession>>();

// ── 实例心跳 ─────────────────────────────────────────────────────────────────

const INSTANCE_ID = os.hostname();
const USER_INSTANCE_KEY_TPL = "user:{userId}:instance";
const USER_INSTANCE_TTL = 86400;
const INSTANCE_ALIVE_KEY_TPL = "pi:instance:{instanceId}:alive";
const INSTANCE_ALIVE_TTL = 60;
const HEARTBEAT_INTERVAL_MS = 30_000;

async function registerInstanceAlive(): Promise<void> {
  const key = INSTANCE_ALIVE_KEY_TPL.replace("{instanceId}", INSTANCE_ID);
  await getRedis().setex(key, INSTANCE_ALIVE_TTL, "1");
}

async function bindUserToInstance(userId: string): Promise<void> {
  const key = USER_INSTANCE_KEY_TPL.replace("{userId}", userId);
  await getRedis().setex(key, USER_INSTANCE_TTL, INSTANCE_ID);
  console.log(`[worker] user 实例绑定: user=${userId} → instance=${INSTANCE_ID}`);
}

// ── Session 管理 ──────────────────────────────────────────────────────────────

function resetInactivityTimer(running: RunningSession): void {
  clearTimeout(running.inactivityTimer);
  running.inactivityTimer = setTimeout(() => {
    console.log(`[worker] session=${running.sessionId}: 闲置超时，自动关闭`);
    closeSession(running.sessionId, "timeout").catch((err) =>
      console.error(`[worker] 自动关闭 session 失败: session=${running.sessionId}`, err)
    );
  }, SESSION_INACTIVITY_MS);
}

async function closeSession(sessionId: string, reason: string): Promise<void> {
  const running = runningSessions.get(sessionId);
  if (!running) return;

  runningSessions.delete(sessionId);
  clearTimeout(running.inactivityTimer);

  console.log(`[worker] session=${sessionId}: 关闭（原因=${reason}）`);

  await running.piHandle.close().catch((err) =>
    console.error(`[worker] 关闭 pi 进程失败: session=${sessionId}`, err)
  );
  unregisterSessionLlmBridge(sessionId);
  unregisterSessionMcpBridge(sessionId);
  await running.closeSubscriber.quit().catch(() => {});
  await running.cancelSubscriber.quit().catch(() => {});
  await destroySandbox(running.userId, sessionId).catch((err) =>
    console.error(`[worker] 释放沙盒失败: session=${sessionId}`, err)
  );

  // 运行中任务在正常停机后保留为 PENDING，等待其 Stream 消息被其他消费者认领。
  const finalStatus = reason === "timeout"
    ? "IDLE"
    : reason === "shutdown" && running.activeTurnId
      ? "PENDING"
      : reason === "shutdown"
        ? "IDLE"
        : "COMPLETED";
  await updateSessionStatus(sessionId, finalStatus).catch(() => {});
  console.log(`[worker] session=${sessionId}: 已完全关闭，最终状态=${finalStatus}`);
}

async function registerSessionMcpBridgeForSkills(
  sessionId: string,
  userId: string,
  skillIds: string[],
): Promise<string[] | undefined> {
  const mcpServerNames = await resolveMcpServersForSkills(userId, skillIds);
  registerSessionMcpBridge(
    sessionId,
    userId,
    process.env.MCP_PROXY_HOST ?? "mcp-proxy",
    Number(process.env.MCP_PROXY_PORT ?? 8080),
    mcpServerNames,
  );
  return mcpServerNames;
}

/**
 * 启动 pi 进程、创建沙盒、订阅 Redis 频道并注册到 runningSessions。
 * openSession（首次创建）和 handleNewMessage（自动重建）共用此函数。
 */
async function startAndRegisterSession(
  sessionId: string,
  userId: string,
  skillIds: string[]
): Promise<RunningSession> {
  await bindUserToInstance(userId);
  await updateSessionStatus(sessionId, "RUNNING");

  const sandboxPaths = await createSandbox(userId, sessionId);
  console.log(`[worker] session=${sessionId}: 沙盒就绪 workspace=${sandboxPaths.workspace}`);

  registerSessionLlmBridge(
    sessionId,
    process.env.LLM_PROXY_HOST ?? "llm-proxy",
    Number(process.env.LLM_PROXY_PORT ?? 9001),
  );
  const mcpServerNames = await registerSessionMcpBridgeForSkills(sessionId, userId, skillIds);

  // 启动 pi 前预热 mcp-proxy 工具列表缓存，避免 pi 调用 tools/list 时缓存尚未建好
  await warmMcpCache(
    userId,
    mcpServerNames,
    process.env.MCP_PROXY_HOST ?? "mcp-proxy",
    Number(process.env.MCP_PROXY_PORT ?? 8080),
  );

  const piHandle = await startPiSession(sessionId, sandboxPaths, skillIds);
  console.log(`[worker] session=${sessionId}: pi 进程已启动`);

  const closeSubscriber = new Redis(config.redis.url);
  const cancelSubscriber = new Redis(config.redis.url);
  const closeChannel = `sessions:${sessionId}:close`;
  const cancelChannel = `sessions:${sessionId}:cancel`;

  const running: RunningSession = {
    sessionId,
    userId,
    piHandle,
    skillIds: [...skillIds],
    skillContentFingerprint: "",
    closeSubscriber,
    cancelSubscriber,
    inactivityTimer: setTimeout(() => {}, 0), // 占位，立即被 resetInactivityTimer 覆盖
    startedAt: Date.now(),
    turnChain: Promise.resolve(),
  };
  runningSessions.set(sessionId, running);
  await refreshSkillContentFingerprint(running);
  resetInactivityTimer(running);

  closeSubscriber.on("message", () => {
    closeSession(sessionId, "user_close").catch((err) =>
      console.error(`[worker] 处理关闭失败: session=${sessionId}`, err)
    );
  });

  cancelSubscriber.on("message", (_channel, msg) => {
    let payload: { turn_id: string };
    try { payload = JSON.parse(msg) as { turn_id: string }; }
    catch { console.error(`[worker] 无法解析 cancel 消息: ${msg}`); return; }
    handleCancelTurn(sessionId, payload.turn_id).catch((err) =>
      console.error(`[worker] 处理中断失败: session=${sessionId} turn=${payload.turn_id}`, err)
    );
  });

  await closeSubscriber.subscribe(closeChannel);
  await cancelSubscriber.subscribe(cancelChannel);
  console.log(`[worker] session=${sessionId}: 已订阅关闭频道 [${closeChannel}]、中断频道 [${cancelChannel}]`);

  return running;
}

/** pi 进程重建（进程退出或 skill 变更时调用，保留沙盒 workspace 与 Redis 订阅） */
async function restartPiForSession(
  running: RunningSession,
  skillIds: string[],
  reason: "pi_dead" | "skill_changed" | "skill_content_changed" = "pi_dead",
): Promise<RunningSession> {
  const { sessionId, userId } = running;
  const reasonText = reason === "skill_changed"
    ? `skill 变更 [${running.skillIds.join(",")}] → [${skillIds.join(",")}]`
    : reason === "skill_content_changed"
      ? `skill 内容已更新 [${skillIds.join(",")}]，热重载 pi`
      : "pi 进程已退出，自动重建";
  console.warn(`[worker] session=${sessionId}: ${reasonText}`);

  unregisterSessionLlmBridge(sessionId);
  unregisterSessionMcpBridge(sessionId);
  await running.piHandle.close().catch(() => {});

  registerSessionLlmBridge(
    sessionId,
    process.env.LLM_PROXY_HOST ?? "llm-proxy",
    Number(process.env.LLM_PROXY_PORT ?? 9001),
  );
  const restartMcpNames = await registerSessionMcpBridgeForSkills(sessionId, userId, skillIds);
  await warmMcpCache(
    userId,
    restartMcpNames,
    process.env.MCP_PROXY_HOST ?? "mcp-proxy",
    Number(process.env.MCP_PROXY_PORT ?? 8080),
  );

  const sandboxPaths = await createSandbox(userId, sessionId);
  running.piHandle = await startPiSession(sessionId, sandboxPaths, skillIds);
  running.skillIds = [...skillIds];
  await refreshSkillContentFingerprint(running);
  console.log(`[worker] session=${sessionId}: pi 进程重建完成`);
  return running;
}

// ── 处理新 session（第一条消息，创建 pi 进程）───────────────────────────────

async function ensureSessionStarted(
  sessionId: string,
  userId: string,
  skillIds: string[],
): Promise<RunningSession> {
  const existing = runningSessions.get(sessionId);
  if (existing) return existing;

  let gate = sessionStartGates.get(sessionId);
  if (!gate) {
    gate = startAndRegisterSession(sessionId, userId, skillIds).finally(() => {
      if (sessionStartGates.get(sessionId) === gate) {
        sessionStartGates.delete(sessionId);
      }
    });
    sessionStartGates.set(sessionId, gate);
  }
  return gate;
}

async function openSession(payload: NewSessionPayload): Promise<void> {
  const { session_id, user_id, request, turn_id, skill_ids = [] } = payload;

  console.log(`[worker] 创建 session: session=${session_id} user=${user_id} turn=${turn_id}`);
  const running = await ensureSessionStarted(session_id, user_id, skill_ids);

  await sendTurnToSession(running, turn_id, request);
}

// ── 处理新消息（追加轮次到已有 session）──────────────────────────────────────

async function handleNewMessage(payload: NewMessagePayload): Promise<void> {
  const { session_id, user_id, request, turn_id, skill_ids = [] } = payload;
  let running = runningSessions.get(session_id);

  if (!running) {
    // pi 进程不在内存中（崩溃或被清理），自动重建后继续处理本条消息
    console.warn(`[worker] session=${session_id}: pi 进程不存在，自动重建`);
    running = await ensureSessionStarted(session_id, user_id, skill_ids);
    console.log(`[worker] session=${session_id}: pi 进程重建完成`);
  } else if (!running.piHandle.isAlive()) {
    running = await restartPiForSession(running, skill_ids, "pi_dead");
  } else if (!skillIdsEqual(running.skillIds, skill_ids)) {
    running = await restartPiForSession(running, skill_ids, "skill_changed");
  } else {
    const latestFingerprint = await computeSessionSkillFingerprint(user_id, skill_ids);
    if (latestFingerprint !== running.skillContentFingerprint) {
      running = await restartPiForSession(running, skill_ids, "skill_content_changed");
    }
  }

  resetInactivityTimer(running);
  await sendTurnToSession(running, turn_id, request);
}

async function clearActiveTurnState(running: RunningSession): Promise<void> {
  await running.piHandle.cancelTurn();
  await running.activeTurnStream?.expire(ACTIVE_TURN_TTL_SECONDS).catch(() => {});
  running.activeTurnId = undefined;
  running.activeTurnStream = undefined;
}

async function sendTurnToSession(running: RunningSession, turnId: string, request: string): Promise<void> {
  const run = async (): Promise<void> => {
    const { sessionId } = running;

    if (running.activeTurnId) {
      console.warn(
        `[worker] session=${sessionId}: 上一轮 turn=${running.activeTurnId} 未结束，先中断再发送 turn=${turnId}`,
      );
      await clearActiveTurnState(running);
    }

    setSessionQuestionId(sessionId, turnId);
    const turnStream = new SessionOutputStream(getRedis(), sessionId, turnId);
    const startAt = Date.now();

    running.activeTurnId = turnId;
    running.activeTurnStream = turnStream;
    await getRedis().setex(`session:${sessionId}:active_turn`, ACTIVE_TURN_TTL_SECONDS, turnId);

    console.log(`[worker] session=${sessionId} turn=${turnId}: 开始执行，request='${request.slice(0, 80).replace(/\n/g, " ")}'`);

    try {
      await running.piHandle.sendTurn(turnId, request, turnStream);
      const elapsed = Date.now() - startAt;
      await turnStream.expire(ACTIVE_TURN_TTL_SECONDS);
      console.log(`[worker] session=${sessionId} turn=${turnId}: 执行完成，耗时 ${elapsed}ms`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] session=${sessionId} turn=${turnId}: 执行失败:`, message);
      await turnStream.pushError(message).catch(() => {});
      await turnStream.pushDone().catch(() => {});
    } finally {
      if (running.activeTurnId === turnId) {
        running.activeTurnId = undefined;
        running.activeTurnStream = undefined;
      }
    }
  };

  const queued = running.turnChain.then(run, run);
  running.turnChain = queued.then(() => undefined, () => undefined);
  await queued;
}

async function handleCancelTurn(sessionId: string, turnId: string): Promise<void> {
  const running = runningSessions.get(sessionId);
  if (!running) {
    console.warn(`[worker] session=${sessionId} turn=${turnId}: 中断请求忽略（session 不在运行）`);
    return;
  }

  // 前端可能持有部署前旧 turn，或与 recovery 竞态；用户意图是停止当前生成
  if (running.activeTurnId && running.activeTurnId !== turnId) {
    console.warn(
      `[worker] session=${sessionId}: 中断 turn 不匹配 requested=${turnId} active=${running.activeTurnId}，仍中断当前活跃轮次`,
    );
  } else if (!running.activeTurnId) {
    console.warn(`[worker] session=${sessionId} turn=${turnId}: worker 无活跃 turn，仍尝试清理 pi 侧残留`);
  } else {
    console.log(`[worker] session=${sessionId} turn=${turnId}: 用户中断，取消 pi 任务`);
  }

  await clearActiveTurnState(running);
  await getRedis().del(`session:${sessionId}:active_turn`).catch(() => {});
}

// ── Redis Streams 可靠任务队列 ────────────────────────────────────────────────

function taskLockKey(taskId: string): string {
  return TASK_LOCK_KEY_TPL.replace("{taskId}", taskId);
}

async function renewTaskLock(lockKey: string): Promise<void> {
  const renewScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('PEXPIRE', KEYS[1], ARGV[2])
    end
    return 0
  `;
  await getRedis().eval(
    renewScript,
    1,
    lockKey,
    INSTANCE_ID,
    String(config.redis.taskLeaseMs),
  );
}

async function releaseTaskLock(lockKey: string): Promise<void> {
  const releaseScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    end
    return 0
  `;
  await getRedis().eval(releaseScript, 1, lockKey, INSTANCE_ID);
}

async function processQueueTask(task: AgentTask): Promise<TaskProcessResult> {
  const lockKey = taskLockKey(task.taskId);
  const acquired = await getRedis().set(
    lockKey,
    INSTANCE_ID,
    "PX",
    config.redis.taskLeaseMs,
    "NX",
  );
  if (acquired !== "OK") {
    console.warn(`[worker] task=${task.taskId}: 执行租约被其他消费者持有，等待后续认领`);
    return { action: "retry" };
  }

  const lockRenewTimer = setInterval(() => {
    renewTaskLock(lockKey).catch((error) => {
      console.error(`[worker] task=${task.taskId}: 续租失败`, error);
    });
  }, config.redis.taskLeaseRenewMs);

  try {
    const claimResult = await claimTaskExecution(task, INSTANCE_ID);
    if (claimResult === "completed") {
      console.log(`[worker] task=${task.taskId}: 已完成任务重复投递，直接确认`);
      return { action: "ack" };
    }

    if (task.taskType === "start") {
      await openSession({
        session_id: task.sessionId,
        user_id: task.userId,
        request: task.request,
        turn_id: task.turnId,
        skill_ids: task.skillIds,
      });
    } else {
      await handleNewMessage({
        session_id: task.sessionId,
        user_id: task.userId,
        request: task.request,
        turn_id: task.turnId,
        skill_ids: task.skillIds,
      });
    }

    await completeTask(task.taskId);
    return { action: "ack" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryCount = await recordTaskFailure(task.taskId, message);
    console.error(`[worker] task=${task.taskId}: 执行失败 retry=${retryCount}`, error);
    if (retryCount >= config.redis.taskMaxAttempts) {
      return { action: "dead_letter", error: message };
    }
    return { action: "retry", error: message };
  } finally {
    clearInterval(lockRenewTimer);
    await releaseTaskLock(lockKey).catch((error) => {
      console.error(`[worker] task=${task.taskId}: 释放租约失败`, error);
    });
  }
}

// ── 主函数 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[worker] pi-runtime 启动中... instance=${INSTANCE_ID}`);

  await connectMongo();
  await connectRedis();

  // 启动 Unix socket 桥：为沙盒提供 llm-proxy 和 mcp-proxy 两个网络白名单出口
  startSocketBridge();
  console.log(`[worker] socket 目录已就绪（LLM/MCP 按 session 注册）`);

  const taskQueue = new ReliableTaskQueue({
    redisUrl: config.redis.url,
    stream: config.redis.taskStream,
    group: config.redis.taskGroup,
    consumer: INSTANCE_ID,
    deadLetterStream: config.redis.taskDlqStream,
    blockMs: config.redis.taskBlockMs,
    claimIdleMs: config.redis.taskClaimIdleMs,
    claimIntervalMs: config.redis.taskClaimIntervalMs,
    readCount: config.redis.taskReadCount,
    claimCount: config.redis.taskClaimCount,
    handleTask: processQueueTask,
  });
  await taskQueue.start();

  await registerInstanceAlive();
  console.log(`[worker] 实例心跳已注册: pi:instance:${INSTANCE_ID}:alive (TTL=${INSTANCE_ALIVE_TTL}s)`);

  const heartbeatTimer = setInterval(() => {
    registerInstanceAlive().catch((err) =>
      console.error("[worker] 心跳刷新失败:", err)
    );
  }, HEARTBEAT_INTERVAL_MS);

  console.log("[worker] pi-runtime 就绪（Redis Streams Consumer Group 已启用）");

  const shutdown = async () => {
    console.log("[worker] pi-runtime 正在关闭...");
    clearInterval(heartbeatTimer);
    await taskQueue.stop();
    // 关闭所有活跃 session
    await Promise.all([...runningSessions.keys()].map((id) => closeSession(id, "shutdown")));
    await getRedis().del(INSTANCE_ALIVE_KEY_TPL.replace("{instanceId}", INSTANCE_ID)).catch(() => {});
    await disconnectRedis();
    await disconnectMongo();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[worker] 启动失败:", err);
  process.exit(1);
});
