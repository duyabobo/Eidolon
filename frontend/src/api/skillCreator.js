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
function withUserQuery(userId) {
    return userId?.trim() ? `?user_id=${encodeURIComponent(userId.trim())}` : "";
}
export const skillCreatorApi = {
    createSession: (userId) => request(`/config/skills/creator/sessions${withUserQuery(userId)}`, { method: "POST" }),
    getSession: (sessionId) => request(`/config/skills/creator/sessions/${encodeURIComponent(sessionId)}`),
    sendMessage: (sessionId, content) => request(`/config/skills/creator/sessions/${encodeURIComponent(sessionId)}/messages`, { method: "POST", body: JSON.stringify({ content }) }),
    publish: (sessionId, payload = {}) => request(`/config/skills/creator/sessions/${encodeURIComponent(sessionId)}/publish`, { method: "POST", body: JSON.stringify(payload) }),
};
