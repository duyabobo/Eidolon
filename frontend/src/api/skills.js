import { apiFetch } from "./http";
async function request(url, options) {
    const resp = await apiFetch(url, options);
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${resp.status}`);
    }
    if (resp.status === 204)
        return undefined;
    return resp.json();
}
export function toSkillRef(scope, name) {
    return scope === "system" ? `global:${name}` : `user:${name}`;
}
export const skillsApi = {
    listForChat: (userId) => {
        const qs = userId?.trim() ? `?user_id=${encodeURIComponent(userId.trim())}` : "";
        return request(`/skills${qs}`);
    },
    listAdmin: () => request("/config/skills"),
    getContent: (name, userId) => {
        const qs = userId?.trim() ? `?user_id=${encodeURIComponent(userId.trim())}` : "";
        return request(`/skills/${encodeURIComponent(name)}/content${qs}`);
    },
    delete: (name, userId) => {
        const qs = userId?.trim() ? `?user_id=${encodeURIComponent(userId.trim())}` : "";
        return request(`/config/skills/${encodeURIComponent(name)}${qs}`, { method: "DELETE" });
    },
};
