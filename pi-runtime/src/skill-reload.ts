/**
 * 检测 session 当前选中 skill 的文件内容是否变更，用于同会话内热重载。
 */
import { createHash } from "crypto";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { parseSkillRef } from "./skill-mcp";

export interface SkillFingerprintInput {
  skillIds: string[];
  globalSkillsRoot: string;
  userSkillsRoot: string;
}

interface FileStatEntry {
  path: string;
  mtimeMs: number;
  size: number;
}

function resolveSkillDirs(input: SkillFingerprintInput): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();

  for (const skillId of input.skillIds) {
    const ref = parseSkillRef(skillId);
    if (!ref.name.trim()) continue;

    if (ref.scope === "global" || ref.scope === "both") {
      const key = `global:${ref.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        dirs.push(join(input.globalSkillsRoot, ref.name));
      }
    }
    if (ref.scope === "user" || ref.scope === "both") {
      const key = `user:${ref.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        dirs.push(join(input.userSkillsRoot, ref.name));
      }
    }
  }

  return dirs;
}

async function collectFileStats(dir: string, relativePrefix = ""): Promise<FileStatEntry[]> {
  const entries: FileStatEntry[] = [];

  let dirEntries;
  try {
    dirEntries = await readdir(dir, { withFileTypes: true });
  } catch {
    return entries;
  }

  for (const entry of dirEntries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      entries.push(...await collectFileStats(fullPath, relativePath));
      continue;
    }
    if (!entry.isFile()) continue;

    try {
      const fileStat = await stat(fullPath);
      entries.push({
        path: relativePath,
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
      });
    } catch {
      // 文件可能在 stat 前被删除，忽略即可
    }
  }

  return entries;
}

/**
 * 根据 skill 目录下所有文件的 mtime + size 生成稳定指纹。
 * skillIds 为空时返回空字符串。
 */
export async function computeSkillContentFingerprint(input: SkillFingerprintInput): Promise<string> {
  if (input.skillIds.length === 0) {
    return "";
  }

  const parts: string[] = [];
  const skillDirs = resolveSkillDirs(input).sort();

  for (const skillDir of skillDirs) {
    const fileStats = await collectFileStats(skillDir);
    fileStats.sort((a, b) => a.path.localeCompare(b.path));
    for (const fileStat of fileStats) {
      parts.push(`${skillDir}:${fileStat.path}:${fileStat.mtimeMs}:${fileStat.size}`);
    }
  }

  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}
