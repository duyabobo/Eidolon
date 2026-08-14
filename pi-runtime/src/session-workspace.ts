/**
 * 会话 workspace 分区约定与路径工具。
 * 语义与 pi_shared.workspace.constants 对齐。
 */
import { mkdir } from "fs/promises";
import { join } from "path";

const SESSION_WORKSPACE_SUBDIR = "workspace";

export const SESSION_ZONE_ARTIFACTS = "artifacts";
export const SESSION_ZONE_UPLOADS = "uploads";

export const SESSION_WORKSPACE_ZONES = [
  SESSION_ZONE_ARTIFACTS,
  SESSION_ZONE_UPLOADS,
] as const;

/** 供 download API 使用的用户根相对路径 */
export function artifactDownloadPath(sessionId: string, relPath: string): string {
  const rel = relPath.replace(/^\/+/, "").replace(/\\/g, "/");
  return `sessions/${sessionId}/${SESSION_WORKSPACE_SUBDIR}/${rel}`;
}

/** 确保会话 workspace 分区存在（artifacts / uploads） */
export async function ensureSessionWorkspaceZones(workspaceRoot: string): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true });
  for (const zone of SESSION_WORKSPACE_ZONES) {
    await mkdir(join(workspaceRoot, zone), { recursive: true });
  }
}
