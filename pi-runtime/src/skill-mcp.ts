/**
 * 从 gateway 的 Skill 列表接口解析 session 应加载的 MCP 工具白名单。
 *
 * 元数据存储已从 MongoDB 迁移到本地 SQLite（由 gateway 统一管理，见
 * gateway/services/skill_meta_store.py），pi-runtime 不再直连数据库，
 * 复用 gateway 已有的公开只读接口 `GET /skills?user_id=`（与前端 Skill 下拉框同源）。
 *
 * 白名单粒度是工具名（mcp_tools），不是 Server 名：
 *   - skill 声明的是它实际会用到的具体工具（如 wiki_combined_search），
 *     不是 mrag/tavily 这类业务 Server 名——Server 名从不出现在 SKILL.md 正文里，
 *     Agent 也就没有理由去猜 mcp({ server: "业务名" })。
 *   - mcp-proxy 收到工具名白名单后，在合并好的工具视图里按名字过滤，
 *     不需要预先知道白名单里的工具具体来自哪个 Server。
 */
import { config } from "./config";

interface SkillRef {
  scope: "global" | "user" | "both";
  name: string;
}

interface SkillListItem {
  name: string;
  scope: "system" | "user";
  mcp_tools: string[];
  user_id: string | null;
}

function parseSkillRef(id: string): SkillRef {
  if (id.startsWith("global:")) return { scope: "global", name: id.slice("global:".length) };
  if (id.startsWith("user:")) return { scope: "user", name: id.slice("user:".length) };
  return { scope: "both", name: id };
}

async function fetchSkillList(userId: string): Promise<SkillListItem[]> {
  const url = `${config.gateway.baseUrl}/skills?user_id=${encodeURIComponent(userId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} 失败: status=${res.status}`);
  }
  return (await res.json()) as SkillListItem[];
}

function refMatchesSkill(ref: SkillRef, skill: SkillListItem, userId: string): boolean {
  if (skill.name !== ref.name) return false;
  if ((ref.scope === "global" || ref.scope === "both") && skill.scope === "system") return true;
  if ((ref.scope === "user" || ref.scope === "both") && skill.scope === "user" && skill.user_id === userId) return true;
  return false;
}

/**
 * 根据 session 选中的 skill_ids 合并 MCP 工具白名单。
 * - 无 skill：undefined（加载全部已启用 MCP 工具）
 * - 有 skill 且并集非空：返回工具名称数组
 * - 有 skill 但未声明 mcp_tools，或 gateway 不可达：undefined（降级为不限制白名单）
 */
export async function resolveMcpToolsForSkills(
  userId: string,
  skillIds: string[],
): Promise<string[] | undefined> {
  if (skillIds.length === 0) {
    return undefined;
  }

  const refs = skillIds.map(parseSkillRef).filter((ref) => ref.name.trim());
  if (refs.length === 0) {
    return undefined;
  }

  let skills: SkillListItem[];
  try {
    skills = await fetchSkillList(userId);
  } catch (err) {
    console.error(`[skill-mcp] user=${userId} skills=${skillIds.join(",")}: 拉取 Skill 列表失败，降级为不限制白名单`, err);
    return undefined;
  }

  const merged = new Set<string>();
  for (const ref of refs) {
    for (const skill of skills) {
      if (!refMatchesSkill(ref, skill, userId)) continue;
      for (const tool of skill.mcp_tools) {
        const cleaned = tool.trim();
        if (cleaned) merged.add(cleaned);
      }
    }
  }

  if (merged.size === 0) {
    console.log(
      `[skill-mcp] user=${userId} skills=${skillIds.join(",")}: 未声明 mcp_tools，使用全部 MCP`,
    );
    return undefined;
  }

  const result = Array.from(merged).sort();
  console.log(
    `[skill-mcp] user=${userId} skills=${skillIds.join(",")}: mcp_tools=${result.join(",")}`,
  );
  return result;
}

export { parseSkillRef };
