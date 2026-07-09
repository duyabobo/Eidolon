import { apiFetch } from "./http";
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
};
