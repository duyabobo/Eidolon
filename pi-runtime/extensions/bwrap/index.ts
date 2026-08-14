/**
 * onenew bwrap 沙盒扩展。
 *
 * ═══════════════════════════════════════════════════════════════
 * ⚠️  PI 版本兼容性说明（升级 pi 时必读）
 * ═══════════════════════════════════════════════════════════════
 * 本文件依赖以下 pi Extension API，升级 pi 后需验证这些点：
 *
 * 1. export default function(pi: ExtensionAPI)
 *    pi 扩展必须导出 default 函数并接收 pi 作为参数（非全局变量）。
 *    当前使用版本：pi@0.79.x
 *
 * 2. pi.registerTool({ name, execute, ... })
 *    接收工具定义对象，通过 spread createXxxTool() 继承默认行为。
 *
 * 3. createBashTool / createReadTool / createWriteTool / createEditTool
 *    createFindTool / createGrepTool / createLsTool
 *    从 @earendil-works/pi-coding-agent 导入，用于创建带 operations 覆盖的工具。
 *
 * 4. execute 返回 { content: [{ type: "text", text }] }
 *
 * 升级 pi 时的验证步骤：
 *   1. docker build（会在构建时暴露 npm 安装错误）
 *   2. 启动容器，确认 bwrap.ready 文件被写入（/tmp/pi-config/{sessionId}/bwrap.ready）
 *   3. 确认 bash 命令在沙盒内执行（curl 等网络命令应失败）
 *   4. 确认 read/write/find/grep/ls 越界路径被拦截
 * ═══════════════════════════════════════════════════════════════
 *
 * 沙盒特性（由 worker 在启动 pi 进程前注入环境变量）：
 *   PI_SANDBOX_WORKSPACE   → session 专属工作目录
 *   PI_SANDBOX_HOME        → session 专属 home
 *   PI_SANDBOX_TMP         → session 临时目录
 *   PI_SANDBOX_USER_FILES  → 用户可读写文件区（管理页上传，跨 session）
 *   PI_SANDBOX_GLOBAL_SKILLS → 系统 Skill 根目录（只读）
 *   PI_SANDBOX_USER_SKILLS  → 用户 Skill 根目录（只读）
 *   PI_SANDBOX_NETWORK_ENABLED → "true" 时允许联网（不传 --unshare-net）
 *   PI_OUTER_SANDBOX=1     → 已在外层隔离内：
 *                             macOS= Seatbelt（禁 /Users 非白名单 + 断网）
 *                             Linux= bwrap（tmpfs 藏其他 session + 可选 unshare-net）
 *
 * 两层模型：
 *   层 1 代码执行：bash 继承外层内核/命名空间隔离（macOS 不可嵌套 sandbox-exec）
 *   层 2 文件工具：guardPath 应用层 workspace jail
 */

import type { BashOperations, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const sandboxRoot = process.env.PI_SANDBOX_ROOT ?? "/data/sandboxes";
const sandboxWorkspace = process.env.PI_SANDBOX_WORKSPACE ?? "";
const sandboxHome = process.env.PI_SANDBOX_HOME ?? "";
const sandboxTmp = process.env.PI_SANDBOX_TMP ?? "";
const sandboxUserFiles = process.env.PI_SANDBOX_USER_FILES ?? "";
const sandboxGlobalSkills = process.env.PI_SANDBOX_GLOBAL_SKILLS ?? "";
const sandboxUserSkills = process.env.PI_SANDBOX_USER_SKILLS ?? "";
const piCodingAgentDir = process.env.PI_CODING_AGENT_DIR ?? "";
const sandboxNetworkEnabled =
  (process.env.PI_SANDBOX_NETWORK_ENABLED ?? "false").toLowerCase() === "true";

/**
 * 是否已运行在外层 bwrap 沙盒内。
 * 当 PI_OUTER_SANDBOX=1 时，pi 进程本身已被 bwrap 隔离（文件系统限制；网络由 PI_SANDBOX_NETWORK_ENABLED 控制），
 * bash 命令继承沙盒上下文，不再需要额外的内层 bwrap 封装。
 * 路径白名单（guardPath）对 read/write/edit 工具仍然生效。
 */
const isInsideOuterSandbox = process.env.PI_OUTER_SANDBOX === "1";

// ── bwrap 参数构造 ────────────────────────────────────────────────────────────

function buildBwrapArgs(cmd: string): string[] {
  const networkArgs = sandboxNetworkEnabled ? [] : ["--unshare-net"];
  return [
    "--ro-bind", "/", "/",
    // 用空 tmpfs 覆盖整个 sandbox 根目录，对 bwrap 内隐藏其他 session/user 数据
    "--tmpfs", sandboxRoot,
    "--bind", sandboxWorkspace, sandboxWorkspace,
    "--bind", sandboxHome, sandboxHome,
    // sandboxTmp 同时挂到自身路径和 /tmp：后者覆盖 --ro-bind / / 造成的只读 /tmp
    ...(sandboxTmp
      ? ["--bind", sandboxTmp, sandboxTmp, "--bind", sandboxTmp, "/tmp"]
      : ["--tmpfs", "/tmp"]),
    ...(sandboxUserFiles ? ["--bind", sandboxUserFiles, sandboxUserFiles] : []),
    ...(sandboxGlobalSkills ? ["--ro-bind", sandboxGlobalSkills, sandboxGlobalSkills] : []),
    ...(sandboxUserSkills ? ["--ro-bind", sandboxUserSkills, sandboxUserSkills] : []),
    "--proc", "/proc",
    "--dev", "/dev",
    ...networkArgs,
    "--unshare-pid",
    "--die-with-parent",
    "--chdir", sandboxWorkspace,
    "--", "bash", "-c", cmd,
  ];
}

/**
 * 实现 BashOperations 接口。
 *
 * 若已在外层 bwrap 沙盒内（PI_OUTER_SANDBOX=1）：
 *   bash 命令直接在当前沙盒内执行，继承外层的网络隔离和文件系统限制。
 *
 * 若未在外层沙盒内（旧模式，兜底）：
 *   bash 命令通过内层 bwrap 执行，提供独立的网络和 PID 隔离。
 */
function createBwrapBashOperations(): BashOperations {
  if (isInsideOuterSandbox) {
    // 外层沙盒模式：直接运行 bash，继承沙盒上下文
    return {
      async exec(command, cwd, { onData, signal, timeout }) {
        return new Promise((resolve, reject) => {
          const child = spawn("bash", ["-c", command], {
            cwd: cwd ?? sandboxWorkspace,
            stdio: ["ignore", "pipe", "pipe"],
          });

          let timedOut = false;
          let timeoutHandle: NodeJS.Timeout | undefined;

          if (timeout !== undefined && timeout > 0) {
            timeoutHandle = setTimeout(() => {
              timedOut = true;
              child.kill("SIGKILL");
            }, timeout * 1000);
          }

          child.stdout?.on("data", onData);
          child.stderr?.on("data", onData);

          const onAbort = () => child.kill("SIGKILL");
          signal?.addEventListener("abort", onAbort, { once: true });

          child.on("error", (err) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            reject(err);
          });

          child.on("close", (code) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            signal?.removeEventListener("abort", onAbort);
            if (signal?.aborted) {
              reject(new Error("aborted"));
            } else if (timedOut) {
              reject(new Error(`timeout:${timeout}`));
            } else {
              resolve({ exitCode: code ?? 1 });
            }
          });
        });
      },
    };
  }

  // 旧模式：通过内层 bwrap 执行（pi 未在外层沙盒内时的兜底）
  return createBwrapInnerOperations();
}

function createBwrapInnerOperations(): BashOperations {
  return {
    async exec(command, _cwd, { onData, signal, timeout }) {
      return new Promise((resolve, reject) => {
        const args = buildBwrapArgs(command);
        const child = spawn("bwrap", args, { stdio: ["ignore", "pipe", "pipe"] });

        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, timeout * 1000);
        }

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        const onAbort = () => child.kill("SIGKILL");
        signal?.addEventListener("abort", onAbort, { once: true });

        child.on("error", (err) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          reject(err);
        });

        child.on("close", (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          signal?.removeEventListener("abort", onAbort);
          if (signal?.aborted) {
            reject(new Error("aborted"));
          } else if (timedOut) {
            reject(new Error(`timeout:${timeout}`));
          } else {
            resolve({ exitCode: code ?? 1 });
          }
        });
      });
    },
  };
}

// ── 路径白名单校验 ────────────────────────────────────────────────────────────

/**
 * 应用层工作区 jail（两层模型层 2）：
 * 文件工具只能访问 workspace / home / userFiles / skills。
 * 使用 realpath 防 symlink 逃逸；新建文件对父目录做 realpath。
 * 相对路径相对 workspace（cwd）解析。
 */
async function guardPath(rawPath: string): Promise<{ safe: true } | { safe: false; reason: string }> {
  const { realpath } = await import("fs/promises");
  const { resolve: pathResolve, dirname, basename, join: pathJoin } = await import("path");

  const trimmed = (rawPath ?? "").trim();
  if (!trimmed) {
    return { safe: false, reason: "路径为空（文件工具必须提供 workspace 内相对路径，如 artifacts/out.txt）" };
  }

  const { isAbsolute } = await import("path");
  const allowed = [
    sandboxWorkspace,
    sandboxHome,
    sandboxUserFiles,
    sandboxGlobalSkills,
    sandboxUserSkills,
  ].filter(Boolean);

  const jailHint =
    "只允许访问本会话 workspace（推荐相对路径：artifacts/xxx、uploads/xxx）、" +
    "USER_FILES（如 wiki/xxx.md）、home 和 skills；不要使用宿主机绝对路径。";

  const underAllowed = (candidate: string) =>
    allowed.some((base) => candidate === base || candidate.startsWith(`${base}/`));

  // wiki/* 固定相对 USER_FILES；其余相对路径先按 workspace，越界再试 USER_FILES
  const preferUserFiles =
    Boolean(sandboxUserFiles)
    && !isAbsolute(trimmed)
    && (trimmed === "wiki" || trimmed.startsWith("wiki/"));

  let tentative: string;
  if (preferUserFiles) {
    tentative = pathResolve(sandboxUserFiles, trimmed);
  } else {
    tentative = pathResolve(sandboxWorkspace, trimmed);
    if (
      sandboxUserFiles
      && !isAbsolute(trimmed)
      && !underAllowed(tentative)
    ) {
      const fromUserFiles = pathResolve(sandboxUserFiles, trimmed);
      if (underAllowed(fromUserFiles)) {
        tentative = fromUserFiles;
      }
    }
  }

  if (!underAllowed(tentative)) {
    return {
      safe: false,
      reason: `路径越界（应用层 jail）: ${trimmed} → ${tentative}（${jailHint}）`,
    };
  }

  let canonical: string;
  try {
    canonical = await realpath(tentative);
  } catch {
    try {
      const parentReal = await realpath(dirname(tentative));
      canonical = pathJoin(parentReal, basename(tentative));
    } catch {
      canonical = tentative;
    }
  }

  if (!underAllowed(canonical)) {
    return {
      safe: false,
      reason: `路径越界（符号链接解析后）: ${trimmed} → ${canonical}（${jailHint}）`,
    };
  }

  return { safe: true };
}

function makeErrorResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// ── 扩展入口 ─────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // 安全关键校验：环境变量未注入说明运行上下文异常，抛错阻止扩展注册（fail-closed）。
  // 扩展抛错 → bwrap.ready 文件不会被写入 → pi-session.ts 检测到并终止 session。
  if (!sandboxWorkspace || !sandboxHome) {
    throw new Error(
      "[bwrap] 严重错误: PI_SANDBOX_WORKSPACE 或 PI_SANDBOX_HOME 未设置，" +
      "拒绝注册工具（fail-closed）。请检查 worker 是否正确注入了沙盒环境变量。"
    );
  }

  // bash：完全替换为 bwrap 沙盒执行（LLM 调用路径）
  const bwrapBash = createBashTool(sandboxWorkspace, { operations: createBwrapBashOperations() });
  pi.registerTool({ ...bwrapBash, label: "bash (sandboxed)" });

  // user_bash：用户在 TUI 里直接输入 shell 命令的路径（--mode rpc 下通常不触发，防御性兜底）
  pi.on("user_bash", () => ({ operations: createBwrapBashOperations() }));

  // read/write/edit：路径白名单校验，通过后 fallthrough 到 pi 默认实现
  for (const [toolName, createTool] of [
    ["read",  createReadTool],
    ["write", createWriteTool],
    ["edit",  createEditTool],
  ] as const) {
    const defaultTool = createTool(sandboxWorkspace);
    pi.registerTool({
      ...defaultTool,
      execute: async (id, params, signal, onUpdate, ctx) => {
        const rawPath = ((params as Record<string, unknown>)["path"] ?? "") as string;
        if (rawPath) {
          const check = await guardPath(rawPath);
          if (!check.safe) {
            console.error(`[bwrap] 拦截越界 tool=${toolName} path=${rawPath}`);
            return makeErrorResult(check.reason);
          }
        }
        return defaultTool.execute(id, params, signal, onUpdate, ctx);
      },
    });
  }

  // find/grep/ls
  for (const [toolName, createTool] of [
    ["find", createFindTool],
    ["grep", createGrepTool],
    ["ls",   createLsTool],
  ] as const) {
    const defaultTool = createTool(sandboxWorkspace);
    pi.registerTool({
      ...defaultTool,
      execute: async (id, params, signal, onUpdate, ctx) => {
        const rawPath = ((params as Record<string, unknown>)["path"] ?? "") as string;
        if (rawPath) {
          const check = await guardPath(rawPath);
          if (!check.safe) {
            console.error(`[bwrap] 拦截越界 tool=${toolName} path=${rawPath}`);
            return makeErrorResult(check.reason);
          }
        }
        return defaultTool.execute(id, params, signal, onUpdate, ctx);
      },
    });
  }

  // 就绪标记文件：必须在所有 registerTool 调用之后写入。
  // "文件存在" = 扩展完整初始化，所有工具保护已注册。
  // pi-session.ts 依赖此文件做 fail-closed 启动校验。
  if (piCodingAgentDir) {
    writeFileSync(join(piCodingAgentDir, "bwrap.ready"), "1", { flag: "w" });
    console.error(`[bwrap] 沙盒扩展已就绪 workspace=${sandboxWorkspace} home=${sandboxHome} files=${sandboxUserFiles} tmp=${sandboxTmp}`);
  } else {
    console.error("[bwrap] 警告: PI_CODING_AGENT_DIR 未设置，无法写入就绪标记文件");
  }
}
