import { mergeTraceHeaders } from "./http";
async function parseError(resp) {
    const err = await resp.json().catch(() => ({}));
    const detail = err.detail;
    if (typeof detail === "string")
        return detail;
    if (Array.isArray(detail) && detail[0]?.msg)
        return detail[0].msg;
    return `HTTP ${resp.status}`;
}
async function request(url, options) {
    const resp = await fetch(url, {
        cache: "no-store",
        ...options,
        headers: mergeTraceHeaders(options?.headers, { json: true }),
    });
    if (!resp.ok)
        throw new Error(await parseError(resp));
    if (resp.status === 204)
        return undefined;
    return resp.json();
}
function withUser(userId, path) {
    const qs = new URLSearchParams({ user_id: userId.trim() });
    if (path !== undefined)
        qs.set("path", path);
    return qs.toString();
}
export const workspaceApi = {
    ls: (userId, path = "") => request(`/config/workspace/ls?${withUser(userId, path)}`),
    mkdir: (userId, path) => request(`/config/workspace/mkdir?${withUser(userId)}`, {
        method: "POST",
        body: JSON.stringify({ path }),
    }),
    upload: async (userId, dirPath, file) => {
        const form = new FormData();
        form.append("file", file);
        const resp = await fetch(`/config/workspace/upload?${withUser(userId, dirPath)}`, {
            method: "POST",
            body: form,
            cache: "no-store",
            headers: mergeTraceHeaders(),
        });
        if (!resp.ok)
            throw new Error(await parseError(resp));
        return resp.json();
    },
    delete: (userId, path) => request(`/config/workspace/entry?${withUser(userId, path)}`, {
        method: "DELETE",
    }),
    download: async (userId, path, filename) => {
        const resp = await fetch(`/config/workspace/download?${withUser(userId, path)}`, { cache: "no-store", headers: mergeTraceHeaders() });
        if (!resp.ok)
            throw new Error(await parseError(resp));
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },
    /** 首页会话附件 → session workspace + knowledge 入库（返回 doc_id） */
    uploadToSession: async (userId, sessionId, file) => {
        const form = new FormData();
        form.append("file", file);
        const qs = new URLSearchParams({ user_id: userId.trim() });
        const resp = await fetch(`/sessions/${encodeURIComponent(sessionId)}/upload?${qs}`, {
            method: "POST",
            body: form,
            cache: "no-store",
            headers: mergeTraceHeaders(),
        });
        if (!resp.ok)
            throw new Error(await parseError(resp));
        return resp.json();
    },
};
