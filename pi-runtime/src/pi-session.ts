import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import { mkdir, writeFile, rm, access as fsAccess, symlink } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "os";
import { SandboxPaths, buildOuterSandboxArgs } from "./sandbox";
import { buildMacosSandboxArgs } from "./sandbox-macos";
import { allocateSessionBridgePorts, SessionBridgePorts } from "./sandbox-ports";
import { config } from "./config";
import { SessionOutputStream } from "./output-stream";
import { extractLastAssistantText, resolveFinalResultContent } from "./final-answer";
import { sessionLlmSockForSandbox } from "./session-llm-bridge";
import { sessionMcpSockForSandbox } from "./session-mcp-bridge";
import {
  writeSessionMcpAdapterConfig,
  type McpDirectToolsSetup,
} from "./session-mcp-config";
import {
  attachPidToSessionCgroup,
  planSessionResourceLimits,
} from "./session-cgroup";
import {
  diffWorkspaceArtifacts,
  snapshotWorkspace,
  type WorkspaceSnapshot,
} from "./workspace-artifacts";
import { artifactDownloadPath } from "./session-workspace";
// ── Pi RPC 协议类型 ───────────────────────────────────────────────────────────

interface PiPromptCommand {
  type: "prompt";
  message: string;
}

interface PiAbortCommand {
  type: "abort" | "abort_bash";
}

interface PiCommandResponse {
  type: "response";
  command: string;
  success: boolean;
  error?: string;
}

interface PiMessageUpdateEvent {
  type: "message_update";
  assistantMessageEvent: {
    type: string;
    delta?: string;
    contentIndex?: number;
  };
}

interface PiToolExecutionStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface PiToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

interface PiAgentEndEvent {
  type: "agent_end";
  messages?: unknown[];
  willRetry?: boolean;
}

type PiEvent =
  | PiCommandResponse
  | PiMessageUpdateEvent
  | PiToolExecutionStartEvent
  | PiToolExecutionEndEvent
  | PiAgentEndEvent
  | { type: string; [key: string]: unknown };

// ── 多轮会话句柄 ─────────────────────────────────────────────────────────────

/**
 * pi 进程句柄，代表一个存活的 pi 进程（对应一个 chat 窗口 / session）。
 * 支持多轮对话：每次用户发送消息调用 sendTurn，pi 进程持续运行，workspace 文件保留。
 */
export interface PiSessionHandle {
  /** 向 pi 发送一条新消息，流式输出到 outputStream，完成后 resolve */
  sendTurn(turnId: string, message: string, outputStream: SessionOutputStream): Promise<void>;
  /** 关闭 pi 进程，清理 pi config 目录（sandbox workspace 由 worker 负责清理） */
  close(): Promise<void>;
  /** pi 子进程是否仍在运行 */
  isAlive(): boolean;
  /**
   * 中断当前轮次：先发送 pi RPC abort（协作式，代价小，进程存活），
   * 限时未确认（pi 可能卡在无法响应中断的工具调用/网络请求上）则 SIGKILL 强制终止整个
   * pi 进程（含沙盒子进程树），确保生成真正停止。
   * 返回 true 表示走到了强制终止：调用方应视 isAlive() 为 false，
   * 下一次 sendTurn 前需要重建 pi 进程（worker 侧已有基于 isAlive() 的自动重建逻辑）。
   */
  cancelTurn(): Promise<boolean>;
}

// ── 内部：当前轮次状态 ────────────────────────────────────────────────────────

interface ActiveTurn {
  turnId: string;
  outputStream: SessionOutputStream;
  resolve: () => void;
  reject: (err: Error) => void;
  bwrapChecked: boolean;  // 首轮校验 bwrap.ready，后续轮次跳过
  /** 本轮累计 text_delta，作为 agent_end.messages 缺失时的兜底 */
  textBuffer: string;
  /** 本轮开始时 workspace 文件 mtime 快照，用于检测产物 */
  workspaceSnapshot: WorkspaceSnapshot;
  /** 用户本轮输入 */
  userMessage: string;
}

// ── 桌面安装包内置搜索工具（fd / rg）──────────────────────────────────────────

const BUNDLED_SEARCH_TOOLS = ["fd", "rg"] as const;

/** 安装包内 pi CLI 与 fd/rg 同目录（build/pi-cli/bin）；容器未设 PI_BIN 时为空 */
function bundledToolsBinDir(): string {
  const piBin = (process.env.PI_BIN ?? "").trim();
  return piBin ? dirname(piBin) : "";
}

/**
 * 把安装包内的 fd/rg 链到 PI_CODING_AGENT_DIR/bin。
 * pi 的 find/grep 会先查这个目录；找不到就会在沙盒里访问 GitHub（默认禁网，必然失败）。
 */
async function linkBundledSearchTools(piConfigDir: string, sessionId: string): Promise<void> {
  const toolsDir = bundledToolsBinDir();
  if (!toolsDir) return;

  const destDir = join(piConfigDir, "bin");
  await mkdir(destDir, { recursive: true });
  const linked: string[] = [];
  for (const name of BUNDLED_SEARCH_TOOLS) {
    const src = join(toolsDir, name);
    try {
      await fsAccess(src);
      await symlink(src, join(destDir, name));
      linked.push(name);
    } catch {
      // 开发态未跑 build-pi-cli.sh 时没有这些二进制，跳过
    }
  }
  if (linked.length > 0) {
    console.log(`[pi-session] session=${sessionId}: 已链接搜索工具 ${linked.join(", ")} -> ${destDir}`);
  } else {
    console.warn(`[pi-session] session=${sessionId}: ${toolsDir} 下未找到 fd/rg，find/grep 可能因沙盒禁网下载失败`);
  }
}

/** 沙盒 Python + 安装包 bin（含 fd/rg）放在 PATH 最前，不依赖本机环境 */
function buildPiPath(): string {
  const basePath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  const prefixes = [
    (process.env.SANDBOX_PYTHON_BIN_DIR ?? "").trim(),
    bundledToolsBinDir(),
  ].filter(Boolean);
  return prefixes.length > 0 ? `${prefixes.join(":")}:${basePath}` : basePath;
}

/**
 * 为 session 创建独立的 pi config 目录，写入 mcp.json（指向沙盒内 mcp-proxy 桥）、
 * models.json（指向沙盒内 llm-proxy 桥），软链接扩展和 skills。
 *
 * 网络策略变更说明：
 *   - mcp.json 只配置一个条目，URL 指向沙盒内 loopback:{bridgePorts.mcpPort}
 *     （→ Unix socket → mcp-proxy）
 *   - models.json baseUrl 指向沙盒内 loopback:{bridgePorts.llmPort}
 *     （→ Unix socket → llm-proxy）
 *   - 真实的 MCP Server 列表由 mcp-proxy 服务从本地 SQLite 读取并管理
 *   - Skill.mcp_tools → directTools：让白名单工具以原始名出现在模型 tool list
 *     （仅靠 X-Mcp-Tools 过滤不够——adapter 默认只有 mcp 网关）
 *
 * bridgePorts 在 Linux 上固定为 9001/8080（bwrap 每 session 独立网络命名空间，
 * 不会冲突）；macOS 上由 allocateSessionBridgePorts 按 session 动态分配
 * （见 sandbox-ports.ts 顶部说明——没有网络命名空间，固定端口会跟真实服务/其他并发
 * session 冲突）。
 */
export function piConfigDirFor(sessionId: string): string {
  return `/tmp/pi-config/${sessionId}`;
}

async function setupPiConfigDir(
  sessionId: string,
  globalSkillsRoot: string,
  userSkillsRoot: string,
  bridgePorts: SessionBridgePorts,
  mcpDirectTools?: McpDirectToolsSetup,
): Promise<string> {
  const piConfigDir = piConfigDirFor(sessionId);
  await mkdir(piConfigDir, { recursive: true });

  await writeSessionMcpAdapterConfig(piConfigDir, mcpDirectTools, bridgePorts.mcpPort);

  // LLM provider 配置：指向沙盒内的 llm-proxy 桥
  const piModelsJson = {
    providers: {
      "llm-proxy": {
        baseUrl: `http://127.0.0.1:${bridgePorts.llmPort}/v1`,
        api: "openai-completions",
        apiKey: process.env.OPENAI_API_KEY ?? "pi-agent-internal",
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: [{
          id: "default",
          name: "LLM Proxy (sandboxed via Unix socket)",
          reasoning: false,
          input: ["text"],
          contextWindow: 128000,
          maxTokens: 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    },
  };
  await writeFile(join(piConfigDir, "models.json"), JSON.stringify(piModelsJson, null, 2));

  // Skills 软链接
  const piSkillsDir = join(piConfigDir, "skills");
  await mkdir(piSkillsDir, { recursive: true });

  const { symlink, readdir } = await import("fs/promises");

  // 扩展软链接（PI_CODING_AGENT_DIR 覆盖默认路径，必须显式链接）
  // bwrap 扩展是安全关键，链接失败直接抛错（fail-closed）
  //
  // 扩展目录解析优先级：
  //   1. PI_EXTENSIONS_DIR（Electron 打包后指向 Resources/pi-cli/extensions）
  //   2. $HOME/.pi/agent/extensions（本机全局安装 / 容器以 root 跑时即 /root/.pi/...）
  // 不能硬编码 "/root/.pi/agent/extensions"：那是 Docker 容器以 root 运行时的巧合路径。
  const defaultExtensionsDir =
    process.env.PI_EXTENSIONS_DIR || join(homedir(), ".pi", "agent", "extensions");
  const piExtensionsDir = join(piConfigDir, "extensions");
  await mkdir(piExtensionsDir, { recursive: true });
  const extensionEntries = await readdir(defaultExtensionsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of extensionEntries) {
    if (!entry.isDirectory()) continue;
    await symlink(join(defaultExtensionsDir, entry.name), join(piExtensionsDir, entry.name)).catch((err: Error) => {
      console.error(`[pi-session] session=${sessionId}: 扩展 "${entry.name}" 链接失败:`, err.message);
    });
  }

  const bwrapExtensionPath = join(piExtensionsDir, "bwrap");
  await fsAccess(bwrapExtensionPath).catch(() => {
    throw new Error(
      `[pi-session] bwrap 扩展未就绪: ${bwrapExtensionPath} 不存在，` +
      `bash 工具将无沙盒防护，session 终止（fail-closed）。`
    );
  });
  console.log(`[pi-session] session=${sessionId}: 已链接 ${extensionEntries.length} 个扩展，bwrap 已就绪`);

  await linkBundledSearchTools(piConfigDir, sessionId);

  for (const [srcRoot, prefix] of [[globalSkillsRoot, "g"], [userSkillsRoot, "u"]] as const) {
    const entries = await readdir(srcRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const linkName = join(piSkillsDir, `${prefix}_${entry.name}`);
      await symlink(join(srcRoot, entry.name), linkName).catch(() => {});
    }
  }

  console.log(`[pi-session] session=${sessionId}: pi config 目录就绪 ${piConfigDir}`);
  return piConfigDir;
}

async function cleanupPiConfigDir(sessionId: string): Promise<void> {
  await rm(`/tmp/pi-config/${sessionId}`, { recursive: true, force: true });
}

function parseSkillRef(id: string): { scope: "global" | "user" | "both"; name: string } {
  if (id.startsWith("global:")) return { scope: "global", name: id.slice("global:".length) };
  if (id.startsWith("user:")) return { scope: "user", name: id.slice("user:".length) };
  return { scope: "both", name: id };
}

function buildSkillArgs(skillIds: string[], globalSkillsRoot: string, userSkillsRoot: string): string[] {
  if (skillIds.length === 0) return [];
  const args: string[] = ["--no-skills"];
  for (const id of skillIds) {
    const { scope, name } = parseSkillRef(id);
    if (scope === "global" || scope === "both") args.push("--skill", join(globalSkillsRoot, name));
    if (scope === "user" || scope === "both") args.push("--skill", join(userSkillsRoot, name));
  }
  console.log(`[pi-session] 加载 skill: ${skillIds.join(", ")}`);
  return args;
}

/**
 * 构建 pi JSONL 会话持久化参数。
 *
 * pi 将对话历史（含 compaction 摘要）保存为
 * userPiSessionsDir/{timestamp}_{sessionId}.jsonl（由 pi SessionManager 命名）。
 * 进程重启后加载同一 session-id，恢复 messages[]，实现会话级记忆。
 */
function buildSessionArgs(userPiSessionsDir: string, sessionId: string): string[] {
  // --session-id：不存在时自动创建；--session 仅加载已有会话，首条消息会失败
  return ["--session-dir", userPiSessionsDir, "--session-id", sessionId];
}

// 等待 pi 确认 abort（agent_end）的最长时间，超时视为协议层中断失败，转为强制终止进程
const CANCEL_ABORT_WAIT_MS = 3000;
// close() 正常关闭（stdin 结束）后，等待 pi 自行退出的最长时间，超时后 SIGKILL 兜底
const CLOSE_GRACEFUL_WAIT_MS = 5000;

/**
 * 启动 pi 进程，等待扩展加载完成，返回 PiSessionHandle。
 *
 * 设计要点：
 *   - pi 进程持续运行，不随单次轮次结束而退出
 *   - workspace 文件在轮次间保留，支持"修改上一轮写的文件"
 *   - pi 自身维护对话历史，无需外部传 context 字段
 */
export async function startPiSession(
  sessionId: string,
  sandboxPaths: SandboxPaths,
  skillIds: string[] = [],
  mcpDirectTools?: McpDirectToolsSetup,
): Promise<PiSessionHandle> {
  const bridgePorts = await allocateSessionBridgePorts();
  const piConfigDir = await setupPiConfigDir(
    sessionId,
    sandboxPaths.globalSkills,
    sandboxPaths.userSkills,
    bridgePorts,
    mcpDirectTools,
  );

  const sandboxPythonBinDir = (process.env.SANDBOX_PYTHON_BIN_DIR ?? "").trim();
  const piEnv: Record<string, string> = {
    PATH: buildPiPath(),
    HOME: sandboxPaths.home,
    TERM: process.env.TERM ?? "xterm",
    PI_SANDBOX_ROOT: process.env.SANDBOX_ROOT ?? "/data/sandboxes",
    PI_SANDBOX_WORKSPACE: sandboxPaths.workspace,
    PI_SANDBOX_HOME: sandboxPaths.home,
    PI_SANDBOX_TMP: sandboxPaths.sessionTmp,
    PI_SANDBOX_USER_FILES: sandboxPaths.userFiles,
    USER_FILES: sandboxPaths.userFiles,
    PI_SANDBOX_GLOBAL_SKILLS: sandboxPaths.globalSkills,
    PI_SANDBOX_USER_SKILLS: sandboxPaths.userSkills,
    PI_SANDBOX_NETWORK_ENABLED: config.sandbox.networkEnabled ? "true" : "false",
    PI_CODING_AGENT_DIR: piConfigDir,
    PI_OUTER_SANDBOX: "1",
    PI_SOCKS_LLM: sessionLlmSockForSandbox(sessionId),
    PI_SOCKS_MCP: sessionMcpSockForSandbox(sessionId),
    // bridge.js 监听端口：Linux 固定 9001/8080，macOS 按 session 动态分配（见 sandbox-ports.ts）
    PI_BRIDGE_LLM_PORT: String(bridgePorts.llmPort),
    PI_BRIDGE_MCP_PORT: String(bridgePorts.mcpPort),
  };
  if (sandboxPythonBinDir) {
    piEnv.SANDBOX_PYTHON_BIN_DIR = sandboxPythonBinDir;
    // 无显示器时 matplotlib 走 Agg，避免沙盒弹 GUI
    piEnv.MPLBACKEND = process.env.MPLBACKEND ?? "Agg";
    console.log(
      `[pi-session] session=${sessionId}: 使用内置沙盒 Python PATH 前缀=${sandboxPythonBinDir}`,
    );
  }
  // Electron 桌面场景：用安装包内的 Electron 二进制当 Node 跑 bridge.js / pi CLI
  // （用户机器上不一定装了 node）。容器不设这些变量，sandbox-init.sh 退回 PATH 的 node。
  if (process.env.NODE_BIN) {
    piEnv.NODE_BIN = process.env.NODE_BIN;
  }
  if (process.env.ELECTRON_RUN_AS_NODE) {
    piEnv.ELECTRON_RUN_AS_NODE = process.env.ELECTRON_RUN_AS_NODE;
  }

  const skillArgs = buildSkillArgs(skillIds, sandboxPaths.globalSkills, sandboxPaths.userSkills);
  const sessionArgs = buildSessionArgs(sandboxPaths.userPiSessions, sessionId);
  const piArgs = [
    "--mode", "rpc",
    "--provider", "llm-proxy",
    "--model", "default",
    ...sessionArgs,
    ...skillArgs,
  ];

  // sandbox-init.sh 负责：启用 loopback（Linux）、启动 TCP↔Unix socket 桥、exec pi
  // __dirname 相对定位：dist/pi-session.js 的上一级即 pi-runtime 包根目录，
  // Docker（/app/dist → /app/extensions）与本地/Electron 打包布局（同级目录）均适用。
  const sandboxInitScript = join(__dirname, "..", "extensions", "sandbox-init", "sandbox-init.sh");
  // Electron 打包后指向 Resources/pi-cli/bin/pi；容器未设置时退回 PATH 里的全局 pi
  const piCommand = process.env.PI_BIN || "pi";
  const isMacos = process.platform === "darwin";

  const { cgroup: sessionCgroup, prlimitArgs } = await planSessionResourceLimits(sessionId);
  let cgroupDestroyed = false;
  const destroySessionCgroup = async () => {
    if (cgroupDestroyed || !sessionCgroup) return;
    cgroupDestroyed = true;
    await sessionCgroup.destroy();
    console.log(`[pi-session] session=${sessionId}: cgroup 已释放`);
  };

  let spawnCommand: string;
  let spawnArgs: string[];
  if (isMacos) {
    // macOS：sandbox-exec -f <渲染后的 Seatbelt profile> <启动脚本> <pi> <pi参数>
    // 无 PID 命名空间可用，进程树清理改用 detached 进程组（见下方 hardKillProcess）
    const outerMacosArgs = await buildMacosSandboxArgs(sandboxPaths, piConfigDir, sessionId, bridgePorts);
    spawnCommand = "sandbox-exec";
    spawnArgs = [...outerMacosArgs, sandboxInitScript, piCommand, ...piArgs];
  } else {
    // Linux：bwrap <沙盒参数> <启动脚本> <pi> <pi参数>，cgroup 不可用时 prlimit 兜底内存限制
    const outerBwrapArgs = buildOuterSandboxArgs(sandboxPaths, piConfigDir, sessionId);
    const bwrapCommandArgs = [...outerBwrapArgs, sandboxInitScript, piCommand, ...piArgs];
    spawnCommand = prlimitArgs.length > 0 ? "prlimit" : "bwrap";
    spawnArgs = prlimitArgs.length > 0 ? [...prlimitArgs, "bwrap", ...bwrapCommandArgs] : bwrapCommandArgs;
  }

  const piProcess: ChildProcess = spawn(spawnCommand, spawnArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: piEnv,
    cwd: sandboxPaths.workspace,
    // macOS 下没有 --unshare-pid 可用，detached 让 sandbox-exec 成为独立进程组 leader，
    // hardKillProcess 通过负 PID 一次性杀掉整棵子进程树（bash 工具等）
    detached: isMacos,
  });

  if (sessionCgroup && piProcess.pid) {
    await attachPidToSessionCgroup(sessionCgroup, piProcess.pid, sessionId);
  }

  console.log(`[pi-session] session=${sessionId}: pi 进程已启动 pid=${piProcess.pid}`);

  // bwrap 就绪标记文件（由 bwrap 扩展在所有 registerTool 完成后写入）
  const bwrapReadyFile = join(piConfigDir, "bwrap.ready");

  // 当前活跃轮次（同一时刻最多一轮）
  let activeTurn: ActiveTurn | null = null;

  // pi 进程退出时的 Promise，供 close() 等待
  let piExitResolve: () => void;
  const piExitPromise = new Promise<void>((res) => { piExitResolve = res; });

  // ── 解析 pi stdout（全局监听，轮次间持续有效）──────────────────────────────
  const rl = createInterface({ input: piProcess.stdout! });

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg: PiEvent;
    try {
      msg = JSON.parse(line) as PiEvent;
    } catch {
      console.warn(`[pi-session] session=${sessionId}: 忽略非 JSON 输出: ${line.slice(0, 100)}`);
      return;
    }

    if (!activeTurn) return; // 没有活跃轮次，忽略（理论上不会发生）

    const { turnId, outputStream, resolve, reject } = activeTurn;

    // bwrap 就绪检查（仅第一轮首次 response.success 时执行）
    const responseEvent = msg as PiCommandResponse;
    if (msg.type === "response" && responseEvent.success && !activeTurn.bwrapChecked) {
      const ready = await fsAccess(bwrapReadyFile).then(() => true).catch(() => false);
      if (!ready) {
        const errMsg = `bwrap 沙盒扩展未就绪（标记文件 ${bwrapReadyFile} 不存在），session 终止（fail-closed）`;
        console.error(`[pi-session] session=${sessionId} turn=${turnId}: ${errMsg}`);
        await outputStream.pushError(errMsg);
        await outputStream.pushDone();
        activeTurn = null;
        piProcess.stdin!.end();
        reject(new Error(errMsg));
        return;
      }
      activeTurn.bwrapChecked = true;
      console.log(`[pi-session] session=${sessionId}: bwrap 扩展已确认就绪`);
    }

    const done = await dispatchPiEvent(
      msg,
      sessionId,
      turnId,
      outputStream,
      activeTurn,
      sandboxPaths.workspace,
    );
    if (done) {
      console.log(`[pi-session] session=${sessionId} turn=${turnId}: 轮次结束`);
      activeTurn = null;
      resolve();
      // 注意：不关闭 stdin，pi 继续等待下一条 prompt
    }
  });

  piProcess.stderr!.on("data", (chunk: Buffer) => {
    const trimmed = chunk.toString().trim();
    if (trimmed) console.error(`[pi-session] session=${sessionId} pi stderr: ${trimmed}`);
  });

  piProcess.on("close", async (code) => {
    console.log(`[pi-session] session=${sessionId}: pi 进程退出 code=${code}`);
    // 若有活跃轮次未完成，通知失败
    if (activeTurn) {
      await activeTurn.outputStream.pushError("pi 进程意外退出").catch(() => {});
      await activeTurn.outputStream.pushDone().catch(() => {});
      activeTurn.reject(new Error(`pi 进程意外退出，code=${code}`));
      activeTurn = null;
    }
    await cleanupPiConfigDir(sessionId).catch(() => {});
    await destroySessionCgroup();
    piExitResolve();
  });

  piProcess.on("error", async (err) => {
    console.error(`[pi-session] session=${sessionId}: pi 进程启动失败:`, err.message);
    if (activeTurn) {
      activeTurn.reject(err);
      activeTurn = null;
    }
    await cleanupPiConfigDir(sessionId).catch(() => {});
    await destroySessionCgroup();
    piExitResolve();
  });

  // ── 返回句柄 ─────────────────────────────────────────────────────────────

  /**
   * 通过操作系统信号强制终止 pi 进程（及其派生的子进程树，如 bash 工具）。
   *
   * Linux：依赖 sandbox.ts 中 bwrap 的 --unshare-pid + --die-with-parent，pi 及其
   * 沙盒内子进程共享同一个独立 PID 命名空间，杀掉命名空间内 PID 1（即此处的
   * piProcess）会被内核连带清空整棵子进程树，不会有遗留僵尸进程继续占用 CPU/网络。
   *
   * macOS：sandbox-exec 没有 PID 命名空间，改用 detached 进程组：spawn 时设置
   * detached=true 使 piProcess 成为独立进程组 leader，其 pid 同时是 pgid；
   * kill(-pid) 向整个进程组发信号，杀掉 sandbox-exec 自身及其派生的所有子进程。
   *
   * 这是协议层 abort（协作式，pi 可能因未接入取消钩子的工具调用/网络请求而无法
   * 及时响应）之外唯一能 100% 保证"真正停止"的手段。
   */
  async function hardKillProcess(): Promise<void> {
    if (piProcess.exitCode !== null || piProcess.signalCode !== null) return;
    console.warn(`[pi-session] session=${sessionId}: SIGKILL 强制终止 pi 进程 pid=${piProcess.pid}`);
    if (isMacos && piProcess.pid) {
      try {
        process.kill(-piProcess.pid, "SIGKILL");
      } catch (err) {
        console.warn(`[pi-session] session=${sessionId}: 进程组 SIGKILL 失败，回退单进程终止`, err);
        piProcess.kill("SIGKILL");
      }
    } else {
      piProcess.kill("SIGKILL");
    }
    await piExitPromise;
  }

  /** 返回 true 表示协议层 abort 未在限时内确认，已升级为强制终止整个 pi 进程 */
  async function cancelActiveTurn(): Promise<boolean> {
    if (!activeTurn) {
      console.warn(`[pi-session] session=${sessionId}: 无活跃轮次，跳过中断`);
      return false;
    }
    const turn = activeTurn;
    console.log(`[pi-session] session=${sessionId} turn=${turn.turnId}: 发送 abort`);

    const abortPayload: PiAbortCommand = { type: "abort" };
    const abortBashPayload: PiAbortCommand = { type: "abort_bash" };
    piProcess.stdin!.write(JSON.stringify(abortPayload) + "\n");
    piProcess.stdin!.write(JSON.stringify(abortBashPayload) + "\n");

    await new Promise<void>((res) => setTimeout(res, CANCEL_ABORT_WAIT_MS));
    if (activeTurn !== turn) return false; // 已通过正常的 agent_end 路径结束

    console.warn(
      `[pi-session] session=${sessionId} turn=${turn.turnId}: 协议层 abort 超时未确认` +
        `（pi 可能卡在工具调用或上游网络请求上），强制终止 pi 进程以保证真正停止`,
    );
    await turn.outputStream.pushCancelled();
    turn.resolve();
    activeTurn = null;

    await hardKillProcess();
    return true;
  }

  return {
    async sendTurn(turnId: string, message: string, outputStream: SessionOutputStream): Promise<void> {
      if (activeTurn) {
        if (activeTurn.turnId.startsWith("recovery-")) {
          console.warn(
            `[pi-session] session=${sessionId}: 新消息到达，先中断残留 recovery=${activeTurn.turnId}`,
          );
          const killed = await cancelActiveTurn();
          if (killed) {
            throw new Error(
              `session=${sessionId}: pi 进程已被强制终止，请等待上层重建 session 后重试`,
            );
          }
        } else {
          throw new Error(`session=${sessionId}: 上一轮 turn=${activeTurn.turnId} 尚未结束，不能发送新消息`);
        }
      }

      let workspaceSnapshot: WorkspaceSnapshot = new Map();
      try {
        workspaceSnapshot = await snapshotWorkspace(sandboxPaths.workspace);
      } catch (err) {
        console.warn(
          `[pi-session] session=${sessionId} turn=${turnId}: workspace 快照失败，本轮不推送附件`,
          err,
        );
      }

      return new Promise<void>((resolve, reject) => {
        activeTurn = {
          turnId,
          outputStream,
          resolve,
          reject,
          bwrapChecked: false,
          textBuffer: "",
          workspaceSnapshot,
          userMessage: message,
        };

        const promptPayload: PiPromptCommand = { type: "prompt", message };
        piProcess.stdin!.write(JSON.stringify(promptPayload) + "\n");
        console.log(
          `[pi-session] session=${sessionId} turn=${turnId}: prompt 已写入 stdin（${message.length}字符）` +
            ` workspaceFiles=${workspaceSnapshot.size}`,
        );
      });
    },

    async close(): Promise<void> {
      console.log(`[pi-session] session=${sessionId}: 关闭 pi 进程`);
      piProcess.stdin!.end();

      const exitedGracefully = await Promise.race([
        piExitPromise.then(() => true),
        new Promise<boolean>((res) => setTimeout(() => res(false), CLOSE_GRACEFUL_WAIT_MS)),
      ]);
      if (!exitedGracefully) {
        console.warn(
          `[pi-session] session=${sessionId}: 关闭超时（stdin 结束后 pi 未自行退出），强制终止`,
        );
        await hardKillProcess();
      }
      await destroySessionCgroup();
    },

    isAlive(): boolean {
      return piProcess.exitCode === null && piProcess.signalCode === null;
    },

    async cancelTurn(): Promise<boolean> {
      return cancelActiveTurn();
    },
  };
}

// ── 事件分发（轮次级别）─────────────────────────────────────────────────────

/**
 * 处理单条 pi 事件，返回 true 表示本轮结束（agent_end 或错误）。
 */
async function dispatchPiEvent(
  event: PiEvent,
  sessionId: string,
  turnId: string,
  outputStream: SessionOutputStream,
  turn: ActiveTurn,
  workspaceRoot: string,
): Promise<boolean> {
  switch (event.type) {
    case "response": {
      const resp = event as PiCommandResponse;
      if (!resp.success) {
        console.error(`[pi-session] session=${sessionId} turn=${turnId}: prompt 命令失败 error=${resp.error}`);
        await outputStream.pushError(resp.error ?? "pi prompt 命令失败");
        await outputStream.pushDone();
        return true;
      }
      return false;
    }

    case "message_update": {
      const e = event as PiMessageUpdateEvent;
      const { type: evType, delta } = e.assistantMessageEvent;
      if (!delta) return false;
      if (evType === "text_delta") {
        turn.textBuffer += delta;
        await outputStream.push({ event_type: "token", content: delta });
      } else if (evType === "thinking_delta") {
        await outputStream.push({ event_type: "thinking", content: delta });
      }
      return false;
    }

    case "tool_execution_start": {
      const e = event as PiToolExecutionStartEvent;
      await outputStream.push({
        event_type: "tool_call",
        content: JSON.stringify({ name: e.toolName, input: e.args }),
      });
      return false;
    }

    case "tool_execution_end": {
      const e = event as PiToolExecutionEndEvent;
      const output = typeof e.result === "string" ? e.result : JSON.stringify(e.result);
      await outputStream.push({
        event_type: "tool_result",
        content: JSON.stringify({ name: e.toolName, output, isError: e.isError }),
      });
      return false;
    }

    case "agent_end": {
      const e = event as PiAgentEndEvent;
      // 自动重试时不结束本轮，继续等后续事件
      if (e.willRetry) {
        console.log(`[pi-session] session=${sessionId} turn=${turnId}: agent_end willRetry=true，继续等待`);
        return false;
      }

      const lastAssistant = extractLastAssistantText(e.messages);
      const finalAnswer = resolveFinalResultContent(lastAssistant, turn.textBuffer);
      if (finalAnswer) {
        await outputStream.push({ event_type: "final_result", content: finalAnswer });
        console.log(
          `[pi-session] session=${sessionId} turn=${turnId}: final_result 已推送 length=${finalAnswer.length}`,
        );
      } else {
        console.warn(`[pi-session] session=${sessionId} turn=${turnId}: 无可用最终答案，跳过 final_result`);
      }

      await pushAssistantFileEvents(
        sessionId,
        turnId,
        workspaceRoot,
        turn.workspaceSnapshot,
        outputStream,
      );

      await outputStream.pushDone();
      return true;
    }

    default: {
      const unknown = event as { type: string; [key: string]: unknown };
      const keys = Object.keys(unknown).filter(k => k !== "type").join(",");
      console.log(`[pi-session] session=${sessionId} turn=${turnId}: 忽略事件 type=${unknown.type} fields=[${keys}]`);
      return false;
    }
  }
}

/** 本轮 workspace 新增/修改文件 → assistant_file 事件 */
async function pushAssistantFileEvents(
  sessionId: string,
  turnId: string,
  workspaceRoot: string,
  before: WorkspaceSnapshot,
  outputStream: SessionOutputStream,
): Promise<void> {
  const artifacts = await diffWorkspaceArtifacts(workspaceRoot, before);
  if (artifacts.length === 0) return;

  for (const file of artifacts) {
    const payload = {
      filename: file.filename,
      relative_path: artifactDownloadPath(sessionId, file.relPath),
      size: file.size,
    };
    await outputStream.push({
      event_type: "assistant_file",
      content: JSON.stringify(payload),
    });
  }
  console.log(
    `[pi-session] session=${sessionId} turn=${turnId}: assistant_file 已推送 count=${artifacts.length}`,
  );
}
