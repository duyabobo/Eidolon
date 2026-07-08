async function request(url, options) {
    const resp = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${resp.status}`);
    }
    return resp.json();
}
// /config/llm → llm-proxy:9001（由 llm-proxy 持久化并热更新内存）
// /config/mcp、/config/skills → admin:9000
export const configApi = {
    getLlm: () => request("/config/llm"),
    saveLlm: (cfg) => request("/config/llm", { method: "PUT", body: JSON.stringify(cfg) }),
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
