/**
 * bwrap 沙盒管理模块。
 *
 * 隔离粒度：session 级别（一个 chat 窗口 = 一个 session = 一套独立目录）。
 *
 * 目录结构：
 *   {SANDBOX_ROOT}/users/{user_id}/sessions/{session_id}/
 *     workspace/
 *       artifacts/  ← Agent 产物（用户只读预览/下载）
 *       uploads/    ← 用户上传（可读写，走知识解析）
 *     home/       ← session 内跨轮次持久（.bashrc、pip 包路径等）
 *     tmp/        ← session 内跨轮次持久
 *
 *   {SANDBOX_ROOT}/users/{user_id}/pi-sessions/ ← pi JSONL 会话文件（会话级记忆，含 compaction）
 *   {SANDBOX_ROOT}/users/{user_id}/memory/      ← 用户级长期记忆（跨 session，设置页「用户记忆」）
 *   {SANDBOX_ROOT}/users/{user_id}/skills/      ← 用户专属 skill，跨 session 永久保留
 *   {SANDBOX_ROOT}/users/{user_id}/files/       ← 用户可读写文件区（管理页上传），跨 session 永久保留
 *   {SANDBOX_ROOT}/global/skills/              ← admin 管理的全局 skill
 *
 * 生命周期：
 *   createSandbox   → session 开始时调用（打开新 chat 或从 IDLE 重启），目录已存在则幂等
 *   destroySandbox  → session 进程结束时调用，仅释放进程资源，workspace 数据保留
 *   purgeSessionData → 仅在用户主动清理数据时调用，彻底删除 workspace / home / tmp
 *
 * 路径一致性：
 *   bwrap 使用 --ro-bind / / + --bind {实际路径} {实际路径}，
 *   内外路径完全相同，pi 的 read/write/edit 工具（Node.js）和 bash 工具（bwrap）
 *   操作的是同一个物理目录，不存在路径映射歧义。
 *
 * 两层隔离（与 macOS Seatbelt 语义对齐）：
 *   层 1 代码执行：外层 bwrap 限制可见文件系统（tmpfs 覆盖 sandboxRoot）+ 可选断网
 *   层 2 文件工具：extensions/bwrap guardPath 应用层 workspace jail
 */
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { config } from "./config";
import { ensureSessionWorkspaceZones } from "./session-workspace";
import { SOCKS_DIR, sessionSocksDir } from "./socket-bridge";

export interface SandboxPaths {
  workspace: string;
  home: string;
  sessionTmp: string;
  userSkills: string;
  globalSkills: string;
  /** 用户级 pi JSONL 会话目录，存放每个 session 的对话历史，支持重启后恢复短期记忆 */
  userPiSessions: string;
  /** 用户可读写文件区（管理页上传），跨 session 共享 */
  userFiles: string;
}

function buildSessionRoot(userId: string, sessionId: string): string {
  return join(config.sandbox.root, "users", userId, "sessions", sessionId);
}

/**
 * 创建 session 沙盒目录，写入初始 .bashrc。
 * 每次打开新 chat 调用一次，创建全新目录。
 */
export async function createSandbox(userId: string, sessionId: string): Promise<SandboxPaths> {
  const sessionRoot = buildSessionRoot(userId, sessionId);
  const workspace = join(sessionRoot, "workspace");
  const home = join(sessionRoot, "home");
  const sessionTmp = join(sessionRoot, "tmp");
  const userSkills = join(config.sandbox.root, "users", userId, "skills");
  const globalSkills = join(config.sandbox.root, "global", "skills");
  const userPiSessions = join(config.sandbox.root, "users", userId, "pi-sessions");
  const userFiles = join(config.sandbox.root, "users", userId, "files");
  const userMemory = join(config.sandbox.root, "users", userId, "memory");

  await ensureSessionWorkspaceZones(workspace);
  await mkdir(home, { recursive: true });
  await mkdir(sessionTmp, { recursive: true });
  await mkdir(userSkills, { recursive: true });
  await mkdir(globalSkills, { recursive: true });
  await mkdir(userPiSessions, { recursive: true });
  await mkdir(userFiles, { recursive: true });
  await mkdir(userMemory, { recursive: true });

  await writeFile(join(home, ".bashrc"), [
    "export HOME=/root",
    "export PATH=/root/.local/bin:/usr/local/bin:/usr/bin:/bin",
    "export PYTHONUSERBASE=/root/.local",
    "export PIP_USER=1",
    `export USER_FILES=${userFiles}`,
    "",
  ].join("\n"));

  console.log(`[sandbox] session=${sessionId} user=${userId}: 沙盒创建完成 workspace=${workspace} files=${userFiles}`);
  return { workspace, home, sessionTmp, userSkills, globalSkills, userPiSessions, userFiles };
}

/**
 * 标记 session 沙盒结束。workspace / home / tmp 目录保留，用户数据不删除。
 * 如需彻底清理磁盘，调用 purgeSessionData。
 */
export async function destroySandbox(userId: string, sessionId: string): Promise<void> {
  console.log(`[sandbox] session=${sessionId}: 沙盒已释放（workspace 保留）`);
}

/**
 * 彻底删除 session 的所有数据（workspace + home + tmp）。
 * 仅在用户明确请求清理数据时调用，不在常规 session 关闭流程中使用。
 */
export async function purgeSessionData(userId: string, sessionId: string): Promise<void> {
  const sessionRoot = buildSessionRoot(userId, sessionId);
  await rm(sessionRoot, { recursive: true, force: true });
  console.log(`[sandbox] session=${sessionId}: session 数据已彻底清除`);
}

/**
 * 构建外层 bwrap 参数：将 pi 进程本身运行在沙盒内。
 *
 * 安全策略：
 *   - --ro-bind / /        根文件系统只读（提供系统工具和 pi 可执行文件）
 *   - --tmpfs sandboxRoot  对沙盒内隐藏其他 session/user 目录
 *   - --bind workspace/home/tmp  session 专属目录可读写
 *   - --bind sessionTmp → /tmp  覆盖根文件系统只读的 /tmp（pi bash 日志等写 /tmp）
 *   - --bind userPiSessions pi JSONL 会话目录可读写（跨 session 共享，用于恢复短期记忆）
 *   - --bind userFiles     用户可读写文件区（管理页上传，跨 session 共享）
 *   - --ro-bind globalSkills/userSkills  Skill 目录只读（pi 渐进式披露读 SKILL.md）
 *   - --bind piConfigDir   pi config 目录可读写（bwrap 扩展需写入 bwrap.ready）
 *   - --tmpfs SOCKS_DIR    覆盖整棵 sock 树，阻止看到同机其它 session
 *   - --ro-bind sessionSocksDir  仅挂载本 session 的 llm/mcp.sock（可 connect，不可篡改）
 *   - --unshare-net        断网（SANDBOX_NETWORK_ENABLED=false 时）
 *   - --unshare-pid        独立 PID 空间
 *   - --die-with-parent    pi-runtime 退出时沙盒子进程自动终止
 */
export function buildOuterSandboxArgs(
  paths: SandboxPaths,
  piConfigDir: string,
  sessionId: string,
): string[] {
  const socksDir = sessionSocksDir(sessionId);
  const networkArgs = config.sandbox.networkEnabled ? [] : ["--unshare-net"];
  if (config.sandbox.networkEnabled) {
    console.log(`[sandbox] session=${sessionId}: SANDBOX_NETWORK_ENABLED=true，bwrap 允许联网`);
  }
  return [
    "--ro-bind", "/", "/",
    "--tmpfs", config.sandbox.root,
    "--bind", paths.workspace, paths.workspace,
    "--bind", paths.home, paths.home,
    "--bind", paths.sessionTmp, paths.sessionTmp,
    // --ro-bind / / 会使 /tmp 只读；pi 的 bash 工具会写 /tmp/pi-bash-*.log，必须可写
    "--bind", paths.sessionTmp, "/tmp",
    "--bind", paths.userPiSessions, paths.userPiSessions,
    "--bind", paths.userFiles, paths.userFiles,
    "--ro-bind", paths.globalSkills, paths.globalSkills,
    "--ro-bind", paths.userSkills, paths.userSkills,
    "--bind", piConfigDir, piConfigDir,
    // 先盖住整棵 sock 树（否则 --ro-bind / / 已暴露全部 session sock）
    "--tmpfs", SOCKS_DIR,
    "--dir", socksDir,
    "--ro-bind", socksDir, socksDir,
    "--proc", "/proc",
    "--dev", "/dev",
    ...networkArgs,
    "--unshare-pid",
    "--die-with-parent",
    "--chdir", paths.workspace,
    "--",
  ];
}
