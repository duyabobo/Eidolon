/**
 * 本轮 workspace 产物检测：turn 开始快照 mtime，结束时 diff 出新增/修改文件。
 * 优先扫描 artifacts/；兼容历史遗留的 workspace 根下非分区文件。
 */
import { readdir, stat } from "fs/promises";
import { basename, join, relative } from "path";
import {
  SESSION_WORKSPACE_ZONES,
  SESSION_ZONE_ARTIFACTS,
} from "./session-workspace";

export type WorkspaceSnapshot = Map<string, number>;

export interface WorkspaceArtifact {
  /** workspace 内相对路径（可用 / 分隔） */
  relPath: string;
  filename: string;
  size: number;
}

/** 跳过的目录名（不递归） */
const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  "dist",
  "build",
  ".cache",
  // 非 Agent 产物分区（含历史 memory 分区残留）
  ...SESSION_WORKSPACE_ZONES.filter((z) => z !== SESSION_ZONE_ARTIFACTS),
  "memory",
]);

const MAX_WALK_DEPTH = 8;
const ZONE_SET = new Set<string>(SESSION_WORKSPACE_ZONES);

async function walkFiles(
  root: string,
  dir: string,
  depth: number,
  out: WorkspaceSnapshot,
): Promise<void> {
  if (depth > MAX_WALK_DEPTH) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[workspace-artifacts] 无法读取目录 ${dir}:`, err);
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      await walkFiles(root, abs, depth + 1, out);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const info = await stat(abs);
      const rel = relative(root, abs).split("\\").join("/");
      out.set(rel, info.mtimeMs);
    } catch (err) {
      console.warn(`[workspace-artifacts] 无法 stat ${abs}:`, err);
    }
  }
}

/** 兼容：workspace 根下不在已知分区内的遗留文件/目录 */
async function walkLegacyRootEntries(
  workspaceRoot: string,
  out: WorkspaceSnapshot,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(workspaceRoot, { withFileTypes: true });
  } catch (err) {
    console.warn(`[workspace-artifacts] 无法读取 workspace 根 ${workspaceRoot}:`, err);
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (ZONE_SET.has(entry.name)) continue;
    const abs = join(workspaceRoot, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(workspaceRoot, abs, 1, out);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const info = await stat(abs);
      out.set(entry.name, info.mtimeMs);
    } catch (err) {
      console.warn(`[workspace-artifacts] 无法 stat ${abs}:`, err);
    }
  }
}

/** 对 workspace 做 mtime 快照（relPath → mtimeMs） */
export async function snapshotWorkspace(workspaceRoot: string): Promise<WorkspaceSnapshot> {
  const snap = new Map<string, number>();
  const artifactsRoot = join(workspaceRoot, SESSION_ZONE_ARTIFACTS);
  await walkFiles(workspaceRoot, artifactsRoot, 0, snap);
  await walkLegacyRootEntries(workspaceRoot, snap);
  return snap;
}

/**
 * 对比前后快照，返回本轮新增或 mtime 变新的文件（含 size）。
 */
export async function diffWorkspaceArtifacts(
  workspaceRoot: string,
  before: WorkspaceSnapshot,
): Promise<WorkspaceArtifact[]> {
  const after = await snapshotWorkspace(workspaceRoot);
  const changed: WorkspaceArtifact[] = [];

  for (const [relPath, mtimeMs] of after) {
    const prev = before.get(relPath);
    if (prev != null && prev >= mtimeMs) continue;

    const abs = join(workspaceRoot, relPath);
    let size = 0;
    try {
      size = (await stat(abs)).size;
    } catch (err) {
      console.warn(`[workspace-artifacts] 无法读取 size ${abs}:`, err);
      continue;
    }

    changed.push({
      relPath,
      filename: basename(relPath),
      size,
    });
  }

  changed.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return changed;
}
