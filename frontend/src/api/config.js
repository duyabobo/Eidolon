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
export const configApi = {
    getLlm: () => request("/config/llm"),
    listLlmProfiles: () => request("/config/llm/profiles"),
    createLlmProfile: (body) => request("/config/llm/profiles", { method: "POST", body: JSON.stringify(body) }),
    updateLlmProfile: (id, body) => request(`/config/llm/profiles/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
    }),
    deleteLlmProfile: (id) => request(`/config/llm/profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),
    activateLlmProfile: (id) => request(`/config/llm/profiles/${encodeURIComponent(id)}/activate`, { method: "PUT" }),
    getMcp: () => request("/config/mcp"),
    saveMcp: (cfg) => request("/config/mcp", { method: "PUT", body: JSON.stringify(cfg) }),
    addServer: (name, cfg) => request(`/config/mcp/servers/${encodeURIComponent(name)}`, {
        method: "POST",
        body: JSON.stringify(cfg),
    }),
    deleteServer: (name) => request(`/config/mcp/servers/${encodeURIComponent(name)}`, {
        method: "DELETE",
    }),
};
