/**
 * pi-runtime 主入口：接收 gateway 直连 HTTP 派发的任务，
 * 管理长生命周期 session（一个 chat 窗口 = 一个 session = 一个 pi 进程）。
 *
 * Session 生命周期（均由 http-server.ts 路由到下列函数）：
 *   POST /tasks（task_type=start）                 → 创建新 session，启动 pi 进程
 *   POST /tasks（task_type=message）                → 向已有 session 发送新消息（新轮次）
 *   POST /sessions/:id/turns/:id/cancel             → 中断当前轮次
 *   POST /sessions/:id/close                        → 关闭 session，销毁 pi 进程和沙盒
 *
 * 单机单用户只有一个 pi-runtime 实例，因此去掉了原基于 Redis Stream Consumer Group 的
 * 多消费者竞争消费、执行租约续期、user→instance 亲和绑定、实例心跳等分布式路由代码，
 * gateway 与本进程之间改为直接的本机 HTTP 调用。
 *
 * Sticky Session 机制：
 *   pi 进程持续运行期间，workspace 文件保留，pi 维护完整对话历史，
 *   无需外部传 context 字段。
 */
import { join } from "path";
import { setupFileLogging } from "./file-logger";
import { config } from "./config";

setupFileLogging();
import { updateSessionStatus } from "./gateway-client";
import { SessionOutputStream } from "./output-stream";
import { HttpServerHandlers, TaskPayload, startHttpServer } from "./http-server";
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
import { resolveMcpToolsForSkills } from "./skill-mcp";
import { computeSkillContentFingerprint } from "./skill-reload";

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
  turn_id: string;      // 本轮次 ID（gateway 生成，用于 SSE stream key）
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
  inactivityTimer: NodeJS.Timeout;
  startedAt: number;
  activeTurnId?: string;
  /** 串行化同一 session 的轮次，避免 recovery 与业务消息并发抢 activeTurn */
  turnChain: Promise<void>;
}

// session 闲置超时（30 分钟无新消息自动关闭）
const SESSION_INACTIVITY_MS = 30 * 60_000;

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

async function closeSession(sessionId: string, reason: "user_close" | "timeout" | "shutdown"): Promise<void> {
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
  await destroySandbox(running.userId, sessionId).catch((err) =>
    console.error(`[worker] 释放沙盒失败: session=${sessionId}`, err)
  );

  // 单机单实例：不存在“留给其他消费者认领”的场景，闲置超时/停机后统一记为可重启的 IDLE，
  // 用户重新发消息时会自动重建沙盒（见 handleNewMessage）。
  const finalStatus = reason === "user_close" ? "COMPLETED" : "IDLE";
  await updateSessionStatus(sessionId, finalStatus).catch(() => {});
  console.log(`[worker] session=${sessionId}: 已完全关闭，最终状态=${finalStatus}`);
}

async function registerSessionMcpBridgeForSkills(
  sessionId: string,
  userId: string,
  skillIds: string[],
): Promise<string[] | undefined> {
  const mcpToolNames = await resolveMcpToolsForSkills(userId, skillIds);
  registerSessionMcpBridge(
    sessionId,
    userId,
    config.mcpProxy.host,
    config.mcpProxy.port,
    mcpToolNames,
  );
  return mcpToolNames;
}

/**
 * 启动 pi 进程、创建沙盒并注册到 runningSessions。
 * openSession（首次创建）和 handleNewMessage（自动重建）共用此函数。
 */
async function startAndRegisterSession(
  sessionId: string,
  userId: string,
  skillIds: string[]
): Promise<RunningSession> {
  await updateSessionStatus(sessionId, "RUNNING");

  const sandboxPaths = await createSandbox(userId, sessionId);
  console.log(`[worker] session=${sessionId}: 沙盒就绪 workspace=${sandboxPaths.workspace}`);

  registerSessionLlmBridge(
    sessionId,
    config.llmProxy.host,
    config.llmProxy.port,
  );
  // X-Mcp-Tools：mcp-proxy 侧过滤；同时把白名单交给 startPiSession 写成
  // pi-mcp-adapter 的 directTools，否则模型工具列表里只有 mcp 网关，看不到具体工具。
  const mcpToolNames = await registerSessionMcpBridgeForSkills(sessionId, userId, skillIds);

  const piHandle = await startPiSession(
    sessionId,
    sandboxPaths,
    skillIds,
    mcpToolNames?.length
      ? {
          userId,
          toolNames: mcpToolNames,
          mcpProxyHost: config.mcpProxy.host,
          mcpProxyPort: config.mcpProxy.port,
        }
      : undefined,
  );
  console.log(`[worker] session=${sessionId}: pi 进程已启动`);

  const running: RunningSession = {
    sessionId,
    userId,
    piHandle,
    skillIds: [...skillIds],
    skillContentFingerprint: "",
    inactivityTimer: setTimeout(() => {}, 0), // 占位，立即被 resetInactivityTimer 覆盖
    startedAt: Date.now(),
    turnChain: Promise.resolve(),
  };
  runningSessions.set(sessionId, running);
  await refreshSkillContentFingerprint(running);
  resetInactivityTimer(running);

  return running;
}

/** pi 进程重建（进程退出或 skill 变更时调用，保留沙盒 workspace） */
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
    config.llmProxy.host,
    config.llmProxy.port,
  );
  const mcpToolNames = await registerSessionMcpBridgeForSkills(sessionId, userId, skillIds);

  const sandboxPaths = await createSandbox(userId, sessionId);
  running.piHandle = await startPiSession(
    sessionId,
    sandboxPaths,
    skillIds,
    mcpToolNames?.length
      ? {
          userId,
          toolNames: mcpToolNames,
          mcpProxyHost: config.mcpProxy.host,
          mcpProxyPort: config.mcpProxy.port,
        }
      : undefined,
  );
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

/** 返回 true 表示中断已升级为强制终止 pi 进程（调用方需在继续发送前重建） */
async function clearActiveTurnState(running: RunningSession): Promise<boolean> {
  const hardKilled = await running.piHandle.cancelTurn();
  running.activeTurnId = undefined;
  return hardKilled;
}

async function sendTurnToSession(running: RunningSession, turnId: string, request: string): Promise<void> {
  const run = async (): Promise<void> => {
    const { sessionId } = running;

    if (running.activeTurnId) {
      console.warn(
        `[worker] session=${sessionId}: 上一轮 turn=${running.activeTurnId} 未结束，先中断再发送 turn=${turnId}`,
      );
      const hardKilled = await clearActiveTurnState(running);
      if (hardKilled) {
        console.warn(`[worker] session=${sessionId}: 中断已强制终止 pi 进程，重建后再发送 turn=${turnId}`);
        await restartPiForSession(running, running.skillIds, "pi_dead");
      }
    }

    setSessionQuestionId(sessionId, turnId);
    const turnStream = new SessionOutputStream(sessionId, turnId);
    const startAt = Date.now();

    running.activeTurnId = turnId;

    console.log(`[worker] session=${sessionId} turn=${turnId}: 开始执行，request='${request.slice(0, 80).replace(/\n/g, " ")}'`);

    try {
      await running.piHandle.sendTurn(turnId, request, turnStream);
      const elapsed = Date.now() - startAt;
      console.log(`[worker] session=${sessionId} turn=${turnId}: 执行完成，耗时 ${elapsed}ms`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] session=${sessionId} turn=${turnId}: 执行失败:`, message);
      await turnStream.pushError(message).catch(() => {});
      await turnStream.pushDone().catch(() => {});
    } finally {
      if (running.activeTurnId === turnId) {
        running.activeTurnId = undefined;
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

  const hardKilled = await clearActiveTurnState(running);
  if (hardKilled) {
    // 无需在此立即重建：handleNewMessage 已基于 isAlive() 在下一条消息到达时自动重建
    console.warn(`[worker] session=${sessionId} turn=${turnId}: 中断已强制终止 pi 进程，下一条消息将自动重建`);
  }
}

// ── 任务派发（gateway 直连 HTTP，替代原 Redis Streams 可靠任务队列）──────────

/**
 * 处理 gateway 派发的任务：fire-and-forget，异常在内部兜底为 SSE error/done 事件 +
 * session 状态置为 FAILED（单机单实例场景下不再有排队重试/死信队列，失败即向用户报错）。
 */
function handleIncomingTask(task: TaskPayload): void {
  const run = async (): Promise<void> => {
    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[worker] task=${task.taskId}: 执行失败:`, message);
      // sendTurnToSession 内部已覆盖大多数失败路径；这里兜底 session 启动阶段（沙盒创建等）的异常，
      // 保证前端已建立的 SSE 连接始终能收到终止事件，不会无限挂起等待。
      const fallbackStream = new SessionOutputStream(task.sessionId, task.turnId);
      await fallbackStream.pushError(message).catch(() => {});
      await fallbackStream.pushDone().catch(() => {});
      await updateSessionStatus(task.sessionId, "FAILED").catch(() => {});
    }
  };
  void run();
}

function getActiveTurn(sessionId: string): string | null {
  return runningSessions.get(sessionId)?.activeTurnId ?? null;
}

// ── 主函数 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[worker] pi-runtime 启动中...");

  // 启动 Unix socket 桥：为沙盒提供 llm-proxy 和 mcp-proxy 两个网络白名单出口
  startSocketBridge();
  console.log("[worker] socket 目录已就绪（LLM/MCP 按 session 注册）");

  const handlers: HttpServerHandlers = {
    handleTask: handleIncomingTask,
    handleCancel: handleCancelTurn,
    handleClose: (sessionId) => closeSession(sessionId, "user_close"),
    getActiveTurn,
  };
  const httpServer = startHttpServer(handlers);

  console.log("[worker] pi-runtime 就绪（本机 HTTP 已启用，无需 Redis/MongoDB）");

  const shutdown = async () => {
    console.log("[worker] pi-runtime 正在关闭...");
    httpServer.close();
    // 关闭所有活跃 session
    await Promise.all([...runningSessions.keys()].map((id) => closeSession(id, "shutdown")));
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[worker] 启动失败:", err);
  process.exit(1);
});
