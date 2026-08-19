import { ChildProcess, spawn } from "child_process";
import { createWriteStream, WriteStream } from "fs";
import { join } from "path";
import http from "http";

const HEALTH_CHECK_INTERVAL_MS = 500;
const HEALTH_CHECK_TIMEOUT_MS = 30_000;
const SHUTDOWN_GRACE_MS = 5_000;

export interface ManagedProcess {
  name: string;
  process: ChildProcess;
}

/**
 * 轮询 `GET http://127.0.0.1:<port>/health`，直到返回 2xx 或超时。
 * cm-server / pi-runtime 均已提供 `/health` 端点（见 cm_server/main.py、http-server.ts）。
 */
function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 2_000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          retryOrFail();
        }
      });
      req.on("error", retryOrFail);
      req.on("timeout", () => req.destroy());
    };

    const retryOrFail = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`端口 ${port} 在 ${timeoutMs}ms 内未通过健康检查`));
        return;
      }
      setTimeout(attempt, HEALTH_CHECK_INTERVAL_MS);
    };

    attempt();
  });
}

/**
 * cm-server / pi-runtime 之间全部走 127.0.0.1 内部通信，绝不应该被用户机器上
 * 配置的系统级 HTTP/SOCKS 代理（常见于公司网络、部分开发者的 Clash/Surge 之类工具）截获。
 * 命中过的真实故障：macOS 系统代理面板里 127.0.0.1/localhost 已经在"例外列表"里，
 * curl 等遵循系统代理配置的工具能正确绕过，但 Python httpx（cm-server 用它连 MCP downstream）
 * 通过 `urllib.request.getproxies()` 读到同一份系统代理配置后不会应用这个例外列表，
 * 会把 loopback 请求也转发给代理，代理再因为连不回本机随机端口而返回 502 Bad Gateway——
 * 现象和"MCP 探测失败"完全一致，且与我们代码逻辑无关，任何配置了系统代理的用户机器都会中招。
 * 显式注入 NO_PROXY 从源头绕开，不依赖每个 HTTP 客户端库自己是否正确处理系统代理例外规则；
 * 大写小写都设是因为不同语言/库遵循的环境变量大小写约定不一致（Python 常见小写 no_proxy）。
 */
const LOOPBACK_NO_PROXY = "127.0.0.1,localhost,::1";
const NO_PROXY_ENV = {
  NO_PROXY: LOOPBACK_NO_PROXY,
  no_proxy: LOOPBACK_NO_PROXY,
};

function pipeToLogFile(child: ChildProcess, logFilePath: string): WriteStream {
  const stream = createWriteStream(logFilePath, { flags: "a" });
  child.stdout?.pipe(stream, { end: false });
  child.stderr?.pipe(stream, { end: false });
  return stream;
}

export interface StartCmServerOptions {
  executablePath: string;
  port: number;
  sqlitePath: string;
  sandboxRoot: string;
  logDir: string;
  piRuntimeBaseUrl: string;
}

export async function startCmServer(options: StartCmServerOptions): Promise<ManagedProcess> {
  const child = spawn(options.executablePath, [], {
    env: {
      ...process.env,
      ...NO_PROXY_ENV,
      CM_SERVER_HOST: "127.0.0.1",
      CM_SERVER_PORT: String(options.port),
      SQLITE_PATH: options.sqlitePath,
      SANDBOX_ROOT: options.sandboxRoot,
      LOG_DIR: options.logDir,
      PI_RUNTIME_BASE_URL: options.piRuntimeBaseUrl,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "pi-agent-internal",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeToLogFile(child, join(options.logDir, "cm-server.stdout.log"));

  await waitForHealth(options.port, HEALTH_CHECK_TIMEOUT_MS);
  return { name: "cm-server", process: child };
}

export interface StartPiRuntimeOptions {
  entryPath: string;
  cwd: string;
  port: number;
  cmServerPort: number;
  sandboxRoot: string;
  logDir: string;
  /** 安装包内 pi CLI 包装脚本绝对路径 */
  piBin: string;
  /** 安装包内 pi 扩展目录绝对路径 */
  piExtensionsDir: string;
  /** 安装包内沙盒 Python bin 目录（python3 + 科学栈）；空则退回系统 PATH */
  sandboxPythonBinDir: string;
}

export async function startPiRuntime(options: StartPiRuntimeOptions): Promise<ManagedProcess> {
  // ELECTRON_RUN_AS_NODE=1：复用 Electron 内置 Node 运行 worker.js，不需要单独打包 Node 运行时
  // （见计划文档「Electron 打包」一节）。process.execPath 在这个模式下就是 Electron 的可执行文件路径。
  // 同一套 NODE_BIN + ELECTRON_RUN_AS_NODE 还会传给沙盒内的 bridge.js / pi CLI，
  // 这样终端用户机器上即使没装 node，也能跑起来。
  const cmServerBaseUrl = `http://127.0.0.1:${options.cmServerPort}`;
  const child = spawn(process.execPath, [options.entryPath], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...NO_PROXY_ENV,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_BIN: process.execPath,
      PI_BIN: options.piBin,
      PI_EXTENSIONS_DIR: options.piExtensionsDir,
      // 沙盒内 python/python3 优先用安装包内置解释器（见 pi-session PATH 注入）
      SANDBOX_PYTHON_BIN_DIR: options.sandboxPythonBinDir,
      PI_RUNTIME_PORT: String(options.port),
      GATEWAY_BASE_URL: cmServerBaseUrl,
      GATEWAY_SSE_BASE_URL: cmServerBaseUrl,
      LLM_PROXY_HOST: "127.0.0.1",
      LLM_PROXY_PORT: String(options.cmServerPort),
      MCP_PROXY_HOST: "127.0.0.1",
      MCP_PROXY_PORT: String(options.cmServerPort),
      SANDBOX_ROOT: options.sandboxRoot,
      SANDBOX_NETWORK_ENABLED: process.env.SANDBOX_NETWORK_ENABLED ?? "false",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "pi-agent-internal",
      // pi-runtime 自己的 file-logger.ts 也读 LOG_DIR（默认 "/app/logs"，容器专属路径），
      // 桌面场景必须显式覆盖，否则启动时 mkdirSync 直接抛 ENOENT 崩溃。
      LOG_DIR: options.logDir,
      // 无显示器环境下 matplotlib 默认用 Agg，避免沙盒里弹 GUI 失败
      MPLBACKEND: process.env.MPLBACKEND ?? "Agg",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeToLogFile(child, join(options.logDir, "pi-runtime.stdout.log"));

  await waitForHealth(options.port, HEALTH_CHECK_TIMEOUT_MS);
  return { name: "pi-runtime", process: child };
}

/** 先 SIGTERM 让子进程走各自的优雅关闭逻辑（cm-server 的 lifespan / worker.ts 的 shutdown），
 * 超时未退出再 SIGKILL 强杀，避免应用退出时残留僵尸进程。 */
export async function stopManagedProcess(managed: ManagedProcess): Promise<void> {
  const { process: child, name } = managed;
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.error(`[process-manager] ${name} 未在 ${SHUTDOWN_GRACE_MS}ms 内退出，强制 kill`);
      child.kill("SIGKILL");
    }, SHUTDOWN_GRACE_MS);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
