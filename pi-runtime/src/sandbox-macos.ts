/**
 * macOS 沙盒管理模块：用 sandbox-exec + Seatbelt profile 替代 Linux 的 bwrap。
 *
 * 背景：bwrap 依赖 Linux 内核的 mount/network/pid namespace，macOS 没有对应机制。
 * sandbox-exec 是 macOS 唯一的进程级 MAC（Mandatory Access Control）沙盒机制
 * （Apple 已标记为 deprecated，但至今没有替代的第三方可用 API，Codex/Claude Code
 * 等同类工具的 macOS 沙盒也是基于它实现的，这是目前唯一现实的选择）。
 *
 * 与 bwrap 的关键差异（决定了本模块不是简单的语法翻译）：
 *   1. 无网络命名空间：bridge.js 监听的桥接端口与真实 llm-proxy/mcp-proxy 共享同一
 *      loopback 地址空间，必须用 sandbox-ports.ts 动态分配、且 Seatbelt profile
 *      要按端口号精确放行，否则会与真实服务端口冲突或彼此串话（见 sandbox-ports.ts）。
 *   2. 无 PID 命名空间：无法像 bwrap --unshare-pid + --die-with-parent 那样让内核
 *      连带清空整棵子进程树，改用 detached 进程组 + 负 PID 信号（见 pi-session.ts
 *      hardKillProcess 的平台分支）。
 *   3. /tmp 等路径在 macOS 上是指向 /private/tmp 的符号链接，SBPL 规则必须用
 *      realpath 解析后的路径，否则规则静默失效（详见 sandbox.sb.template 顶部注释）。
 */
import { mkdir, readFile, realpath, writeFile } from "fs/promises";
import { dirname, basename, join } from "path";
import { SandboxPaths } from "./sandbox";
import { sessionLlmSockForSandbox } from "./session-llm-bridge";
import { sessionMcpSockForSandbox } from "./session-mcp-bridge";
import { SessionBridgePorts } from "./sandbox-ports";
import { config } from "./config";

/** extensions/macos-sandbox 相对 dist/ 的位置：Docker 与本地/Electron 打包布局一致 */
const EXTENSIONS_DIR = join(__dirname, "..", "extensions");
const TEMPLATE_PATH = join(EXTENSIONS_DIR, "macos-sandbox", "sandbox.sb.template");

/** 路径可能尚不存在（如新建 session 的 socket 文件），realpath 失败则退化到父目录解析 */
async function safeRealpath(rawPath: string): Promise<string> {
  try {
    return await realpath(rawPath);
  } catch {
    try {
      const parentReal = await realpath(dirname(rawPath));
      return join(parentReal, basename(rawPath));
    } catch {
      return rawPath;
    }
  }
}

/**
 * 网络放行规则分三段：
 *   1. network-bind：bridge.js 绑定监听两个 TCP 桥接端口
 *   2. network-inbound：pi 进程作为客户端连接 bridge.js 时，Seatbelt 在 bridge.js
 *      一侧把"接受这个连接"归类为 inbound，仅有 network-bind 不够——实测验证：
 *      缺这条规则时 bind() 能成功但外部连接一律被拒（EPERM 发生在 accept 阶段，
 *      不是 bind 阶段，容易误判为端口规则写错，这是本模块开发阶段踩到的坑）。
 *   3. network-outbound：pi 进程发起的 TCP 连接（到桥接端口）+ bridge.js 反向连接
 *      的 Unix domain socket（llm.sock/mcp.sock）。Seatbelt 把 AF_UNIX connect 也
 *      归入 network-outbound，必须单独用 literal 路径放行（不受端口规则覆盖）。
 */
function buildNetworkRules(
  ports: SessionBridgePorts,
  llmSockPath: string,
  mcpSockPath: string,
): { comment: string; rules: string } {
  if (config.sandbox.networkEnabled) {
    return {
      comment: "SANDBOX_NETWORK_ENABLED=true，不限制网络",
      rules: "(allow network*)",
    };
  }
  const rules = [
    "(deny network*)",
    `(allow network-bind (local ip "localhost:${ports.llmPort}"))`,
    `(allow network-bind (local ip "localhost:${ports.mcpPort}"))`,
    `(allow network-inbound (local ip "localhost:${ports.llmPort}"))`,
    `(allow network-inbound (local ip "localhost:${ports.mcpPort}"))`,
    `(allow network-outbound (local ip "localhost:${ports.llmPort}") (remote ip "localhost:${ports.llmPort}"))`,
    `(allow network-outbound (local ip "localhost:${ports.mcpPort}") (remote ip "localhost:${ports.mcpPort}"))`,
    `(allow network-outbound (literal "${llmSockPath}"))`,
    `(allow network-outbound (literal "${mcpSockPath}"))`,
  ].join("\n");
  return { comment: "默认拒绝，仅放行本 session 的 LLM/MCP 桥接端口与 Unix socket", rules };
}

async function renderProfile(
  paths: SandboxPaths,
  piConfigDir: string,
  sessionId: string,
  ports: SessionBridgePorts,
): Promise<string> {
  const template = await readFile(TEMPLATE_PATH, "utf-8");

  const [
    workspace, home, sessionTmp, userMemory, userPiSessions, userFiles,
    piConfigDirReal, globalSkills, userSkills, sandboxRoot, llmSockPath, mcpSockPath,
  ] = await Promise.all([
    safeRealpath(paths.workspace),
    safeRealpath(paths.home),
    safeRealpath(paths.sessionTmp),
    safeRealpath(paths.userMemory),
    safeRealpath(paths.userPiSessions),
    safeRealpath(paths.userFiles),
    safeRealpath(piConfigDir),
    safeRealpath(paths.globalSkills),
    safeRealpath(paths.userSkills),
    safeRealpath(config.sandbox.root),
    safeRealpath(sessionLlmSockForSandbox(sessionId)),
    safeRealpath(sessionMcpSockForSandbox(sessionId)),
  ]);

  const { comment: networkComment, rules: networkRules } = buildNetworkRules(ports, llmSockPath, mcpSockPath);

  const substitutions: Record<string, string> = {
    WORKSPACE: workspace,
    HOME: home,
    SESSION_TMP: sessionTmp,
    USER_MEMORY: userMemory,
    USER_PI_SESSIONS: userPiSessions,
    USER_FILES: userFiles,
    PI_CONFIG_DIR: piConfigDirReal,
    GLOBAL_SKILLS: globalSkills,
    USER_SKILLS: userSkills,
    SANDBOX_ROOT: sandboxRoot,
    NETWORK_MODE_COMMENT: networkComment,
    NETWORK_RULES: networkRules,
  };

  let rendered = template;
  for (const [key, value] of Object.entries(substitutions)) {
    rendered = rendered.split(`{{${key}}}`).join(value);
  }
  console.log(`[sandbox-macos] session=${sessionId}: Seatbelt profile 已渲染`);
  return rendered;
}

/**
 * 构建 macOS 沙盒的 sandbox-exec 前缀参数。
 * 返回值与 buildOuterSandboxArgs（Linux/bwrap）语义对齐：调用方在其后拼接
 * [sandboxInitScript, "pi", ...piArgs] 即可得到完整 spawn 参数。
 */
export async function buildMacosSandboxArgs(
  paths: SandboxPaths,
  piConfigDir: string,
  sessionId: string,
  ports: SessionBridgePorts,
): Promise<string[]> {
  const profile = await renderProfile(paths, piConfigDir, sessionId, ports);
  const profilePath = join(piConfigDir, "sandbox.sb");
  await mkdir(piConfigDir, { recursive: true });
  await writeFile(profilePath, profile, "utf-8");
  return ["-f", profilePath];
}
