import { apiFetch } from "./http";

export interface SkillDraft {
  name: string;
  description: string;
  content: string;
  tags?: string[];
  /** 仅展示/溯源用（这个 Skill 的工具来自哪些 Server），不参与运行时过滤 */
  mcp_servers?: string[];
  /** 运行时白名单，精确到工具名，由 mcp-proxy 按此过滤可用 MCP 工具 */
  mcp_tools?: string[];
}

/**
 * 与后端 SKILL.md 格式对齐，供右侧预览直接渲染。
 *
 * frontmatter 用 ```yaml 代码块包裹，而不是裸的 `---`：Markdown 渲染器（CommonMark）
 * 把没有空行分隔的连续行当作同一段落，单个换行会被合并成空格，导致 name/description/
 * mcp_servers 等字段挤成一行。代码块内文本按原样保留换行，可以正确逐行展示。
 * 正文 content 已是标准 Markdown（含空行分隔），仍在代码块外正常渲染。
 */
export function buildSkillMarkdown(draft: SkillDraft): string {
  const meta = [`name: ${draft.name}`, `description: ${draft.description}`];
  if ((draft.tags ?? []).length > 0) {
    meta.push("tags:");
    for (const tag of draft.tags ?? []) meta.push(`  - ${tag}`);
  }
  if ((draft.mcp_servers ?? []).length > 0) {
    meta.push("mcp_servers:");
    for (const server of draft.mcp_servers ?? []) meta.push(`  - ${server}`);
  }
  if ((draft.mcp_tools ?? []).length > 0) {
    meta.push("mcp_tools:");
    for (const tool of draft.mcp_tools ?? []) meta.push(`  - ${tool}`);
  }
  return ["```yaml", ...meta, "```", "", draft.content.trim(), ""].join("\n");
}

export interface SkillCreatorMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export interface SkillCreatorSession {
  id: string;
  user_id?: string | null;
  messages: SkillCreatorMessage[];
  draft: SkillDraft | null;
  published: boolean;
  skill_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const resp = await apiFetch(url, options);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${resp.status}`);
  }
  return resp.json();
}

export const skillCreatorApi = {
  /**
   * 获取或创建 skill-creator 会话。
   * - skillName 指定时：加载该 Skill 的会话（编辑模式）
   * - forceNew=true：强制新建（新建对话按钮使用）
   * - 默认：复用未发布草稿，无则新建
   */
  openSession: (userId?: string, forceNew = false, skillName?: string) => {
    const params = new URLSearchParams();
    if (userId?.trim()) params.set("user_id", userId.trim());
    if (forceNew) params.set("force_new", "true");
    if (skillName?.trim()) params.set("skill_name", skillName.trim());
    const qs = params.toString() ? `?${params.toString()}` : "";
    return request<SkillCreatorSession>(`/config/skills/creator/sessions${qs}`, { method: "POST" });
  },

  getSession: (sessionId: string) =>
    request<SkillCreatorSession>(`/config/skills/creator/sessions/${encodeURIComponent(sessionId)}`),

  resetSession: (sessionId: string) =>
    request<SkillCreatorSession>(`/config/skills/creator/sessions/${encodeURIComponent(sessionId)}/reset`, { method: "POST" }),

  sendMessage: (sessionId: string, content: string, signal?: AbortSignal) =>
    request<{ message: SkillCreatorMessage; draft: SkillDraft | null }>(
      `/config/skills/creator/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: "POST", body: JSON.stringify({ content }), signal },
    ),

  publish: (sessionId: string, payload: Partial<SkillDraft> & { hidden?: boolean } = {}) =>
    request<{ name: string; description: string; tags?: string[]; hidden?: boolean; user_id?: string | null }>(
      `/config/skills/creator/sessions/${encodeURIComponent(sessionId)}/publish`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
};
