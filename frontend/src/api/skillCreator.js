import { apiFetch, mergeTraceHeaders } from "./http";
/**
 * 与后端 SKILL.md 格式对齐，供右侧预览直接渲染。
 *
 * frontmatter 用 ```yaml 代码块包裹，而不是裸的 `---`：Markdown 渲染器（CommonMark）
 * 把没有空行分隔的连续行当作同一段落，单个换行会被合并成空格，导致 name/description/
 * mcp_tools 等字段挤成一行。代码块内文本按原样保留换行，可以正确逐行展示。
 * 正文 content 已是标准 Markdown（含空行分隔），仍在代码块外正常渲染。
 */
export function buildSkillMarkdown(draft) {
    const meta = [`name: ${draft.name}`, `description: ${draft.description}`];
    if ((draft.tags ?? []).length > 0) {
        meta.push("tags:");
        for (const tag of draft.tags ?? [])
            meta.push(`  - ${tag}`);
    }
    if ((draft.mcp_tools ?? []).length > 0) {
        meta.push("mcp_tools:");
        for (const tool of draft.mcp_tools ?? [])
            meta.push(`  - ${tool}`);
    }
    return ["```yaml", ...meta, "```", "", draft.content.trim(), ""].join("\n");
}
async function request(url, options) {
    const resp = await apiFetch(url, options);
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${resp.status}`);
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
    openSession: (userId, forceNew = false, skillName) => {
        const params = new URLSearchParams();
        if (userId?.trim())
            params.set("user_id", userId.trim());
        if (forceNew)
            params.set("force_new", "true");
        if (skillName?.trim())
            params.set("skill_name", skillName.trim());
        const qs = params.toString() ? `?${params.toString()}` : "";
        return request(`/config/skills/creator/sessions${qs}`, { method: "POST" });
    },
    getSession: (sessionId) => request(`/config/skills/creator/sessions/${encodeURIComponent(sessionId)}`),
    resetSession: (sessionId) => request(`/config/skills/creator/sessions/${encodeURIComponent(sessionId)}/reset`, { method: "POST" }),
    sendMessage: (sessionId, content, signal) => request(`/config/skills/creator/sessions/${encodeURIComponent(sessionId)}/messages`, { method: "POST", body: JSON.stringify({ content }), signal }),
    publish: (sessionId, payload = {}) => request(`/config/skills/creator/sessions/${encodeURIComponent(sessionId)}/publish`, { method: "POST", body: JSON.stringify(payload) }),
    /** 附件写入对应 skill 目录 uploads/（仅存储，不做融合） */
    uploadFile: async (sessionId, file) => {
        const form = new FormData();
        form.append("file", file);
        const resp = await fetch(`/config/skills/creator/sessions/${encodeURIComponent(sessionId)}/files`, {
            method: "POST",
            body: form,
            cache: "no-store",
            headers: mergeTraceHeaders(),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail ?? `HTTP ${resp.status}`);
        }
        return resp.json();
    },
};
