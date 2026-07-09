/**
 * Session 级 cgroup v2 资源限制（内存 / CPU）。
 *
 * 在 spawn bwrap 后将 PID 写入 cgroup.procs，限制该 session 整棵进程树。
 * 若容器内无法创建子 cgroup（Docker 默认未委托控制器），降级为 prlimit 内存限制。
 */
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { config } from "./config";

const CGROUP_V2_MOUNT = "/sys/fs/cgroup";
const SESSION_GROUP = "pi-sessions";

export interface SessionCgroupHandle {
  path: string;
  destroy: () => Promise<void>;
}

export interface SessionResourcePlan {
  cgroup: SessionCgroupHandle | null;
  /** cgroup 不可用时，用 prlimit 包裹 bwrap（仅内存 RLIMIT_AS） */
  prlimitArgs: string[];
}

export function parseMemoryLimit(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "max" || trimmed === "0") {
    return null;
  }
  const match = /^(\d+(?:\.\d+)?)([kKmMgG])?$/.exec(trimmed);
  if (!match) {
    const asNumber = Number(trimmed);
    return Number.isFinite(asNumber) && asNumber > 0 ? Math.floor(asNumber) : null;
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? "").toUpperCase();
  const multipliers: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
  return Math.floor(value * (multipliers[unit] ?? 1));
}

async function readCgroupV2RelPath(): Promise<string | null> {
  try {
    const content = await readFile("/proc/self/cgroup", "utf8");
    for (const line of content.split("\n")) {
      if (line.startsWith("0::")) {
        return line.slice(3).trim() || "/";
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveCgroupParent(): Promise<string | null> {
  if (config.sandbox.cgroup.basePath.trim()) {
    return config.sandbox.cgroup.basePath.trim();
  }
  const rel = await readCgroupV2RelPath();
  if (!rel) return null;
  return join(CGROUP_V2_MOUNT, rel);
}

async function tryEnableControllers(parentPath: string): Promise<void> {
  const controllers = ["memory", "cpu"] as const;
  for (const name of controllers) {
    try {
      await writeFile(join(parentPath, "cgroup.subtree_control"), `+${name}`, { flag: "a" });
    } catch {
      // 父 cgroup 可能已启用或当前环境不允许，忽略
    }
  }
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function destroyCgroupPath(cgroupPath: string): Promise<void> {
  try {
    await rm(cgroupPath, { recursive: true, force: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EEXIST") {
      console.warn(`[cgroup] 删除 cgroup 失败（可能仍有进程）: ${cgroupPath}`);
      return;
    }
    console.warn(`[cgroup] 删除 cgroup 失败: ${cgroupPath}`, err);
  }
}

export async function createSessionCgroup(sessionId: string): Promise<SessionCgroupHandle | null> {
  if (!config.sandbox.cgroup.enabled) {
    return null;
  }

  const memoryMaxBytes = parseMemoryLimit(config.sandbox.cgroup.memoryMax);
  const cpuMax = config.sandbox.cgroup.cpuMax.trim();
  if (memoryMaxBytes === null && (!cpuMax || cpuMax.toLowerCase() === "max")) {
    console.warn("[cgroup] 未配置 memory/cpu 上限，跳过 session cgroup");
    return null;
  }

  const parentPath = await resolveCgroupParent();
  if (!parentPath) {
    console.warn("[cgroup] 无法解析 cgroup 父路径，跳过 session 资源限制");
    return null;
  }

  await tryEnableControllers(parentPath);

  const safeId = sanitizeSessionId(sessionId);
  const cgroupPath = join(parentPath, SESSION_GROUP, safeId);

  try {
    await mkdir(cgroupPath, { recursive: true });

    if (memoryMaxBytes !== null) {
      await writeFile(join(cgroupPath, "memory.max"), String(memoryMaxBytes));
    }
    if (cpuMax && cpuMax.toLowerCase() !== "max") {
      await writeFile(join(cgroupPath, "cpu.max"), cpuMax);
    }

    console.log(
      `[cgroup] session=${sessionId}: 已创建 cgroup path=${cgroupPath}` +
      `${memoryMaxBytes !== null ? ` memory.max=${memoryMaxBytes}` : ""}` +
      `${cpuMax && cpuMax.toLowerCase() !== "max" ? ` cpu.max=${cpuMax}` : ""}`,
    );

    return {
      path: cgroupPath,
      destroy: async () => destroyCgroupPath(cgroupPath),
    };
  } catch (err) {
    console.warn(`[cgroup] session=${sessionId}: 创建 cgroup 失败，跳过资源限制`, err);
    await destroyCgroupPath(cgroupPath);
    return null;
  }
}

function buildPrlimitFallback(memoryMaxBytes: number | null): string[] {
  if (memoryMaxBytes === null) {
    return [];
  }
  // util-linux prlimit 要求 --as=N 或 --as N -- cmd；分开传 --as 与数值会被当成要执行的命令名
  return [`--as=${memoryMaxBytes}`, "--"];
}

/** 优先 cgroup；失败且配置了内存上限时用 prlimit 降级（Docker 默认环境常见） */
export async function planSessionResourceLimits(sessionId: string): Promise<SessionResourcePlan> {
  const memoryMaxBytes = config.sandbox.cgroup.enabled
    ? parseMemoryLimit(config.sandbox.cgroup.memoryMax)
    : null;

  const cgroup = await createSessionCgroup(sessionId);
  if (cgroup) {
    return { cgroup, prlimitArgs: [] };
  }

  const prlimitArgs = buildPrlimitFallback(memoryMaxBytes);
  if (prlimitArgs.length > 0 && config.sandbox.cgroup.prlimitFallback) {
    console.warn(
      `[cgroup] session=${sessionId}: cgroup 不可用，降级 prlimit --as=${memoryMaxBytes}（RLIMIT_AS）`,
    );
    return { cgroup: null, prlimitArgs };
  }

  if (memoryMaxBytes !== null) {
    console.warn(
      `[cgroup] session=${sessionId}: cgroup 不可用，已跳过资源限制（需宿主机 cgroup 委托；` +
      "或显式设置 SANDBOX_PRLIMIT_FALLBACK=true 并调大 SANDBOX_CGROUP_MEMORY_MAX）",
    );
  }
  return { cgroup: null, prlimitArgs: [] };
}

export async function attachPidToSessionCgroup(
  handle: SessionCgroupHandle,
  pid: number,
  sessionId: string,
): Promise<void> {
  if (!pid || pid <= 0) return;
  try {
    await writeFile(join(handle.path, "cgroup.procs"), String(pid));
    console.log(`[cgroup] session=${sessionId}: pid=${pid} 已加入 cgroup`);
  } catch (err) {
    console.warn(`[cgroup] session=${sessionId}: pid=${pid} 加入 cgroup 失败`, err);
  }
}
