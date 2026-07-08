import { clearCachedKnowledgeKey, getCachedKnowledgeKeyHeader, getSceneUidHeader, readCachedKnowledgeKey, setKnowledgeSceneUid, writeCachedKnowledgeKey, } from "./knowledgeKeyCache";
function apiHeaders(extra) {
    return { ...getSceneUidHeader(), ...getCachedKnowledgeKeyHeader(), ...extra };
}
function jsonHeaders() {
    return apiHeaders({ "Content-Type": "application/json" });
}
async function request(url, options) {
    const headers = {
        ...apiHeaders(),
        ...options?.headers,
    };
    const resp = await fetch(url, { cache: "no-store", ...options, headers });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${resp.status}`);
    }
    if (resp.status === 204)
        return undefined;
    return resp.json();
}
/** 远程模式下获取并缓存 knowledge_key；userId 来自「历史」页 */
export async function ensureKnowledgeKey(cfg, userId, forceRefresh = false) {
    const uid = userId.trim();
    setKnowledgeSceneUid(uid);
    if (!cfg.base_url?.trim()) {
        clearCachedKnowledgeKey();
        return null;
    }
    if (!uid) {
        clearCachedKnowledgeKey();
        throw new Error("请先在「历史」页设置用户 ID");
    }
    if (!forceRefresh) {
        const cached = readCachedKnowledgeKey(cfg, uid);
        if (cached)
            return cached;
    }
    clearCachedKnowledgeKey();
    const resp = await request("/config/knowledge/service/key", {
        method: "POST",
        headers: jsonHeaders(),
    });
    writeCachedKnowledgeKey(cfg, uid, resp.knowledge_key);
    return resp.knowledge_key;
}
export const knowledgeApi = {
    getServiceConfig: () => request("/config/knowledge/service"),
    listServiceEnvironments: () => request("/config/knowledge/service/environments"),
    saveServiceConfig: (cfg) => request("/config/knowledge/service", {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify(cfg),
    }),
    fetchKnowledgeKey: () => request("/config/knowledge/service/key", {
        method: "POST",
        headers: jsonHeaders(),
    }),
    listBases: (page = 1, pageSize = 20) => request(`/config/knowledge/bases?page=${page}&page_size=${pageSize}`),
    getBase: (kbId) => request(`/config/knowledge/bases/${encodeURIComponent(kbId)}`),
    createBase: (body) => request("/config/knowledge/bases", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(body),
    }),
    updateBase: (kbId, body) => request(`/config/knowledge/bases/${encodeURIComponent(kbId)}`, {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify(body),
    }),
    deleteBase: (kbId) => request(`/config/knowledge/bases/${encodeURIComponent(kbId)}`, { method: "DELETE" }),
    listDocuments: (kbId, page = 1, pageSize = 20) => request(`/config/knowledge/bases/${encodeURIComponent(kbId)}/documents?page=${page}&page_size=${pageSize}`),
    uploadDocument: async (kbId, file) => {
        const form = new FormData();
        form.append("file", file);
        const resp = await fetch(`/config/knowledge/bases/${encodeURIComponent(kbId)}/documents`, {
            method: "POST",
            body: form,
            cache: "no-store",
            headers: apiHeaders(),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail ?? `HTTP ${resp.status}`);
        }
        return resp.json();
    },
    deleteDocument: (kbId, docId) => request(`/config/knowledge/bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`, { method: "DELETE" }),
    getDocument: (kbId, docId) => request(`/config/knowledge/bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`),
    downloadDocument: async (kbId, docId, filename) => {
        const resp = await fetch(`/config/knowledge/bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}/download`, { cache: "no-store", headers: apiHeaders() });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail ?? `HTTP ${resp.status}`);
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
    },
    getWikiGraphByDoc: (docId, knowledgeIds) => request("/config/knowledge/wiki/graph/by_doc", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ doc_id: docId, knowledge_ids: knowledgeIds }),
    }),
    getWikiNodeDetail: (nodeId, knowledgeIds) => request("/config/knowledge/wiki/nodes/detail", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ node_id: nodeId, knowledge_ids: knowledgeIds }),
    }),
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
