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
export const mcpApi = {
    listForChat: (userId) => {
        const qs = userId?.trim() ? `?user_id=${encodeURIComponent(userId.trim())}` : "";
        return request(`/mcp${qs}`);
    },
    addUserServer: (userId, name, cfg) => request(`/mcp/servers/${encodeURIComponent(name)}?user_id=${encodeURIComponent(userId)}`, { method: "POST", body: JSON.stringify(cfg) }),
    deleteUserServer: (userId, name) => fetch(`/mcp/servers/${encodeURIComponent(name)}?user_id=${encodeURIComponent(userId)}`, {
        method: "DELETE",
    }),
};
