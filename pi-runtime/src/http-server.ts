/**
 * pi-runtime 本机 HTTP 入口：替代原 Redis Stream 任务队列 + Pub/Sub 控制信号。
 *
 * 单机单用户只有一个 gateway、一个 pi-runtime 实例，不存在多消费者竞争问题，
 * 因此 gateway 直接以 HTTP 调用本服务派发任务（`POST /tasks`）、中断轮次
 * （`POST /sessions/:id/turns/:id/cancel`）、关闭 session（`POST /sessions/:id/close`）、
 * 查询当前活跃轮次（`GET /sessions/:id/active_turn`，读内存 `runningSessions`）。
 *
 * 用 Node 内置 http 模块手写极简路由，避免为一个进程内 IPC 端点引入 Express 等依赖。
 */
import http, { IncomingMessage, ServerResponse } from "http";
import { config } from "./config";

export interface TaskPayload {
  taskId: string;
  taskType: "start" | "message";
  sessionId: string;
  userId: string;
  request: string;
  turnId: string;
  skillIds: string[];
}

export interface HttpServerHandlers {
  /** 派发任务：fire-and-forget，内部自行处理异步执行与失败上报 */
  handleTask: (task: TaskPayload) => void;
  handleCancel: (sessionId: string, turnId: string) => Promise<void>;
  handleClose: (sessionId: string) => Promise<void>;
  getActiveTurn: (sessionId: string) => string | null;
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseTaskPayload(body: Record<string, unknown>): TaskPayload {
  const taskType = body.task_type;
  if (taskType !== "start" && taskType !== "message") {
    throw new Error(`未知任务类型: ${String(taskType)}`);
  }
  const { task_id, session_id, user_id, request, turn_id, skill_ids } = body;
  if (!task_id || !session_id || !user_id || request == null || !turn_id) {
    throw new Error("任务字段不完整");
  }
  return {
    taskId: String(task_id),
    taskType,
    sessionId: String(session_id),
    userId: String(user_id),
    request: String(request),
    turnId: String(turn_id),
    skillIds: Array.isArray(skill_ids) ? skill_ids.map(String) : [],
  };
}

export function startHttpServer(handlers: HttpServerHandlers): http.Server {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, handlers).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[http-server] 请求处理异常: ${req.method} ${req.url}`, message);
      if (!res.headersSent) {
        sendJson(res, 500, { error: message });
      }
    });
  });

  server.listen(config.server.port, () => {
    console.log(`[http-server] pi-runtime HTTP 服务已监听 :${config.server.port}`);
  });
  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handlers: HttpServerHandlers,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (method === "POST" && path === "/tasks") {
    let task: TaskPayload;
    try {
      task = parseTaskPayload(await readJsonBody(req));
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    handlers.handleTask(task);
    sendJson(res, 202, { accepted: true });
    return;
  }

  const cancelMatch = path.match(/^\/sessions\/([^/]+)\/turns\/([^/]+)\/cancel$/);
  if (method === "POST" && cancelMatch) {
    await handlers.handleCancel(cancelMatch[1], cancelMatch[2]);
    res.writeHead(204);
    res.end();
    return;
  }

  const closeMatch = path.match(/^\/sessions\/([^/]+)\/close$/);
  if (method === "POST" && closeMatch) {
    await handlers.handleClose(closeMatch[1]);
    res.writeHead(204);
    res.end();
    return;
  }

  const activeTurnMatch = path.match(/^\/sessions\/([^/]+)\/active_turn$/);
  if (method === "GET" && activeTurnMatch) {
    sendJson(res, 200, { turn_id: handlers.getActiveTurn(activeTurnMatch[1]) });
    return;
  }

  sendJson(res, 404, { error: "not found" });
}
