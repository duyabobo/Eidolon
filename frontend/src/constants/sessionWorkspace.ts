/**
 * 会话级虚拟文件系统分区（与 pi_shared / pi-runtime 语义对齐）。
 *
 * - 对话产物：会话 workspace 内、除 uploads 外的文件（含根目录与 artifacts/）
 * - 用户上传：sessions/{sid}/workspace/uploads/
 * - session-memory：pi JSONL（users/{uid}/pi-sessions/{timestamp}_{sid}.jsonl）
 *
 * Agent 的 cwd 是 workspace 根，常把文件直接写在根下，而不是 artifacts/ 子目录。
 */
export const SESSION_ZONE_ARTIFACTS = "artifacts";
export const SESSION_ZONE_UPLOADS = "uploads";
export const SESSION_ZONE_SESSION_MEMORY = "session-memory";

/** 用户根下 pi JSONL 会话目录（相对用户根） */
export const PI_SESSIONS_DIR = "pi-sessions";

export type SessionZone =
  | typeof SESSION_ZONE_ARTIFACTS
  | typeof SESSION_ZONE_UPLOADS
  | typeof SESSION_ZONE_SESSION_MEMORY;

export interface SessionZoneMeta {
  id: SessionZone;
  label: string;
  hint: string;
  writable: boolean;
}

export const SESSION_ZONES: readonly SessionZoneMeta[] = [
  {
    id: SESSION_ZONE_ARTIFACTS,
    label: "对话产物",
    hint: "本会话生成的文件（不含用户上传）",
    writable: false,
  },
  {
    id: SESSION_ZONE_UPLOADS,
    label: "用户上传",
    hint: "可上传/删除，解析后可查看图谱",
    writable: true,
  },
  {
    id: SESSION_ZONE_SESSION_MEMORY,
    label: "会话记忆",
    hint: "pi JSONL（含 compaction）",
    writable: false,
  },
] as const;

export function sessionWorkspaceRoot(sessionId: string): string {
  return `sessions/${sessionId}/workspace`;
}

export function sessionArtifactsDir(sessionId: string): string {
  return `${sessionWorkspaceRoot(sessionId)}/${SESSION_ZONE_ARTIFACTS}`;
}

/**
 * pi SessionManager 命名：`{ISO时间戳}_{sessionId}.jsonl`
 * （见 @earendil-works/pi-coding-agent SessionManager）
 */
export function isPiSessionFileForSession(fileName: string, sessionId: string): boolean {
  if (!sessionId || !fileName.endsWith(".jsonl")) return false;
  return (
    fileName === `${sessionId}.jsonl` ||
    fileName.endsWith(`_${sessionId}.jsonl`)
  );
}

export function sessionZoneRoot(sessionId: string, zone: SessionZone): string {
  if (zone === SESSION_ZONE_SESSION_MEMORY) {
    return PI_SESSIONS_DIR;
  }
  // 对话产物 = 整个 workspace（列表层再隐藏 uploads），否则根目录写出的 md 会「看不见」
  if (zone === SESSION_ZONE_ARTIFACTS) {
    return sessionWorkspaceRoot(sessionId);
  }
  return `${sessionWorkspaceRoot(sessionId)}/${zone}`;
}

/** 对话产物视图下，workspace 根不展示分区套娃（uploads / artifacts） */
export function isHiddenInArtifactsZone(
  entryName: string,
  currentPath: string,
  workspaceRoot: string,
): boolean {
  if (entryName === "." || entryName === "..") return false;
  if (currentPath !== workspaceRoot) return false;
  return entryName === SESSION_ZONE_UPLOADS || entryName === SESSION_ZONE_ARTIFACTS;
}

/** 面包屑去掉多余的 artifacts/ 前缀 */
export function artifactsDisplayRel(relPath: string): string {
  if (relPath === SESSION_ZONE_ARTIFACTS) return "";
  const prefix = `${SESSION_ZONE_ARTIFACTS}/`;
  if (relPath.startsWith(prefix)) return relPath.slice(prefix.length);
  return relPath;
}

export function mergeArtifactsRootEntries<T extends { name: string }>(
  rootEntries: T[],
  artifactEntries: T[],
): T[] {
  const fromRoot = rootEntries.filter((entry) => {
    if (entry.name === "." || entry.name === "..") return true;
    return entry.name !== SESSION_ZONE_UPLOADS && entry.name !== SESSION_ZONE_ARTIFACTS;
  });
  const fromArtifacts = artifactEntries.filter(
    (entry) => entry.name !== "." && entry.name !== "..",
  );
  return [...fromRoot, ...fromArtifacts];
}

export function joinWorkspacePath(parent: string, name: string): string {
  if (!parent) return name;
  return `${parent}/${name}`;
}

export function isPathWithinZone(path: string, zoneRoot: string): boolean {
  return path === zoneRoot || path.startsWith(`${zoneRoot}/`);
}

export function relativeWithinZone(currentPath: string, zoneRoot: string): string {
  if (!currentPath.startsWith(zoneRoot)) return "";
  return currentPath.slice(zoneRoot.length).replace(/^\//, "");
}
