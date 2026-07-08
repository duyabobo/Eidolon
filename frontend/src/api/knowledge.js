async function request(url, options) {
    const resp = await fetch(url, options);
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${resp.status}`);
    }
    if (resp.status === 204)
        return undefined;
    return resp.json();
}
export const knowledgeApi = {
    listBases: (page = 1, pageSize = 20) => request(`/config/knowledge/bases?page=${page}&page_size=${pageSize}`),
    createBase: (body) => request("/config/knowledge/bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }),
    updateBase: (kbId, body) => request(`/config/knowledge/bases/${encodeURIComponent(kbId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }),
    deleteBase: (kbId) => request(`/config/knowledge/bases/${encodeURIComponent(kbId)}`, { method: "DELETE" }),
    listDocuments: (kbId, page = 1, pageSize = 20) => request(`/config/knowledge/bases/${encodeURIComponent(kbId)}/documents?page=${page}&page_size=${pageSize}`),
    uploadDocument: async (kbId, file) => {
        const form = new FormData();
        form.append("file", file);
        const resp = await fetch(`/config/knowledge/bases/${encodeURIComponent(kbId)}/documents`, { method: "POST", body: form });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail ?? `HTTP ${resp.status}`);
        }
        return resp.json();
    },
    deleteDocument: (kbId, docId) => request(`/config/knowledge/bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`, { method: "DELETE" }),
    downloadUrl: (kbId, docId) => `/config/knowledge/bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}/download`,
};
export function formatFileSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function docStatusLabel(status) {
    const map = {
        uploaded: "已上传",
        processing: "处理中",
        indexed: "已索引",
        failed: "失败",
    };
    return map[status];
}
