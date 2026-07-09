/**
 * 从 MongoDB skills 元数据解析 session 应加载的 MCP Server 白名单。
 */
import { getDb } from "./mongo-client";

interface SkillRef {
  scope: "global" | "user" | "both";
  name: string;
}

function parseSkillRef(id: string): SkillRef {
  if (id.startsWith("global:")) return { scope: "global", name: id.slice("global:".length) };
  if (id.startsWith("user:")) return { scope: "user", name: id.slice("user:".length) };
  return { scope: "both", name: id };
}

function buildLookupQueries(userId: string, skillIds: string[]): object[] {
  const queries: object[] = [];
  const seen = new Set<string>();

  for (const skillId of skillIds) {
    const ref = parseSkillRef(skillId);
    if (!ref.name.trim()) continue;

    if (ref.scope === "global" || ref.scope === "both") {
      const key = `global:${ref.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        queries.push({
          name: ref.name,
          $or: [{ user_id: null }, { user_id: { $exists: false } }],
        });
      }
    }
    if (ref.scope === "user" || ref.scope === "both") {
      const key = `user:${ref.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        queries.push({ name: ref.name, user_id: userId });
      }
    }
  }

  return queries;
}

/**
 * 根据 session 选中的 skill_ids 合并 MCP Server 白名单。
 * - 无 skill：undefined（加载全部已启用 MCP）
 * - 有 skill 且并集非空：返回 Server 名称数组
 * - 有 skill 但未声明 mcp_servers：undefined（兼容旧 Skill）
 */
export async function resolveMcpServersForSkills(
  userId: string,
  skillIds: string[],
): Promise<string[] | undefined> {
  if (skillIds.length === 0) {
    return undefined;
  }

  const queries = buildLookupQueries(userId, skillIds);
  if (queries.length === 0) {
    return undefined;
  }

  const docs = await getDb()
    .collection("skills")
    .find({ $or: queries })
    .project({ mcp_servers: 1 })
    .toArray();

  const merged = new Set<string>();
  for (const doc of docs) {
    if (!Array.isArray(doc.mcp_servers)) continue;
    for (const item of doc.mcp_servers) {
      const cleaned = String(item).trim();
      if (cleaned) merged.add(cleaned);
    }
  }

  if (merged.size === 0) {
    console.log(
      `[skill-mcp] user=${userId} skills=${skillIds.join(",")}: 未声明 mcp_servers，使用全部 MCP`,
    );
    return undefined;
  }

  const result = Array.from(merged).sort();
  console.log(
    `[skill-mcp] user=${userId} skills=${skillIds.join(",")}: mcp_servers=${result.join(",")}`,
  );
  return result;
}

export { parseSkillRef };
