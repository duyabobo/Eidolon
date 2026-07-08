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
function buildQuery(params) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === "")
            continue;
        q.set(key, String(value));
    }
    const serialized = q.toString();
    return serialized ? `?${serialized}` : "";
}
export const mcpApi = {
    /** 对话场景：仅返回已启用的 Server */
    listForChat: (userId) => request(`/mcp${buildQuery({ user_id: userId?.trim(), include_disabled: false })}`),
    /** 配置页：可选包含已禁用 Server */
    listServers: (userId, includeDisabled = true) => request(`/mcp${buildQuery({ user_id: userId?.trim(), include_disabled: includeDisabled })}`),
    getServerStatus: (userId, includeDisabled = false) => request(`/mcp/status${buildQuery({ user_id: userId?.trim(), include_disabled: includeDisabled })}`),
    probeServer: (userId, name, scope) => request(`/mcp/servers/${encodeURIComponent(name)}/status${buildQuery({
        user_id: userId?.trim(),
        scope,
    })}`),
    addUserServer: (userId, name, cfg) => request(`/mcp/servers/${encodeURIComponent(name)}?user_id=${encodeURIComponent(userId)}`, { method: "POST", body: JSON.stringify(cfg) }),
    deleteUserServer: (userId, name) => fetch(`/mcp/servers/${encodeURIComponent(name)}?user_id=${encodeURIComponent(userId)}`, {
        method: "DELETE",
    }),
};
