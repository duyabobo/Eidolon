import {
  clearCachedKnowledgeKey,
  getCachedKnowledgeKeyHeader,
  getSceneUidHeader,
  readCachedKnowledgeKey,
  setKnowledgeSceneUid,
  writeCachedKnowledgeKey,
} from "./knowledgeKeyCache";
import { mergeTraceHeaders } from "./http";

export interface ChunkingConfig {
  chunk_size: number;
  chunk_overlap: number;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  type: "document" | "multimodal";
  document_count: number;
  chunking_config: ChunkingConfig | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBaseList {
  items: KnowledgeBase[];
  total: number;
  page: number;
  page_size: number;
}

export interface KnowledgeDocument {
  id: string;
  kb_id: string;
  name: string;
  file_size: number;
  status: "uploaded" | "processing" | "indexed" | "failed";
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocumentList {
  items: KnowledgeDocument[];
  total: number;
  page: number;
  page_size: number;
}

export interface KnowledgeServiceConfig {
  base_url: string;
  environment?: "local" | "prod" | "test";
  created_at?: string | null;
}

export interface KnowledgeEnvironmentOption {
  id: "local" | "prod" | "test";
  label: string;
  base_url: string;
}

export interface KnowledgeKeyResponse {
  knowledge_key: string;
}

export interface WikiGraphNode {
  node_id: string;
  title: string;
  type: string;
  source: string;
  tree_node_id: string;
  knowledge_id: string;
  tags: string[];
  created_at: string;
}

export interface WikiGraphEdge {
  source_id: string;
  target_id: string;
  description: string;
  source_doc_id: string;
}

export interface WikiDocumentGraph {
  doc_id: string;
  node_count: number;
  edge_count: number;
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
  took_ms: number;
}

export interface WikiNodeItem {
  node_id: string;
  title: string;
  type: string;
  source: string;
  source_doc_id: string;
  knowledge_id: string;
  tree_node_id: string;
  tags: string[];
  keywords_en: string[];
  keywords_zh: string[];
  overview: string;
  body: string;
  body_sections: Record<string, string>;
  references: string;
  connections: Array<Record<string, unknown> | string>;
  metadata?: Record<string, unknown>;
  attachment_oss_url: string;
  created_at: string;
  doc_lang: string;
  score: number | null;
}

export interface WikiNodeDetailResponse {
  node: WikiNodeItem;
  took_ms: number;
}

function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...getSceneUidHeader(), ...getCachedKnowledgeKeyHeader(), ...extra };
}

function jsonHeaders(): Record<string, string> {
  return apiHeaders({ "Content-Type": "application/json" });
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = mergeTraceHeaders(
    {
      ...apiHeaders(),
      ...(options?.headers as Record<string, string> | undefined),
    },
    { json: true },
  );
  const resp = await fetch(url, { cache: "no-store", ...options, headers });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${resp.status}`);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json();
}

/** 远程模式下获取并缓存 knowledge_key；userId 在聊天页右上角「历史」中设置 */
export async function ensureKnowledgeKey(
  cfg: KnowledgeServiceConfig,
  userId: string,
  forceRefresh = false,
): Promise<string | null> {
  const uid = userId.trim();
  setKnowledgeSceneUid(uid);

  if (!cfg.base_url?.trim()) {
    clearCachedKnowledgeKey();
    return null;
  }
  if (!uid) {
    clearCachedKnowledgeKey();
    throw new Error("请先在右上角「历史」中设置用户 ID");
  }
  if (!forceRefresh) {
    const cached = readCachedKnowledgeKey(cfg, uid);
    if (cached) return cached;
  }
  clearCachedKnowledgeKey();
  const resp = await request<KnowledgeKeyResponse>("/config/knowledge/service/key", {
    method: "POST",
    headers: jsonHeaders(),
  });
  writeCachedKnowledgeKey(cfg, uid, resp.knowledge_key);
  return resp.knowledge_key;
}

export const knowledgeApi = {
  getServiceConfig: () => request<KnowledgeServiceConfig>("/config/knowledge/service"),

  listServiceEnvironments: () =>
    request<{ items: KnowledgeEnvironmentOption[] }>("/config/knowledge/service/environments"),

  saveServiceConfig: (cfg: KnowledgeServiceConfig) =>
    request<KnowledgeServiceConfig>("/config/knowledge/service", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify(cfg),
    }),

  fetchKnowledgeKey: () =>
    request<KnowledgeKeyResponse>("/config/knowledge/service/key", {
      method: "POST",
      headers: jsonHeaders(),
    }),

  listBases: (page = 1, pageSize = 20) =>
    request<KnowledgeBaseList>(`/config/knowledge/bases?page=${page}&page_size=${pageSize}`),

  getBase: (kbId: string) =>
    request<KnowledgeBase>(`/config/knowledge/bases/${encodeURIComponent(kbId)}`),

  createBase: (body: {
    name: string;
    description?: string;
    type?: "document" | "multimodal";
    chunking_config?: ChunkingConfig;
  }) =>
    request<KnowledgeBase>("/config/knowledge/bases", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    }),

  updateBase: (kbId: string, body: { name?: string; description?: string; chunking_config?: ChunkingConfig }) =>
    request<KnowledgeBase>(`/config/knowledge/bases/${encodeURIComponent(kbId)}`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    }),

  deleteBase: (kbId: string) =>
    request<void>(`/config/knowledge/bases/${encodeURIComponent(kbId)}`, { method: "DELETE" }),

  listDocuments: (kbId: string, page = 1, pageSize = 20) =>
    request<KnowledgeDocumentList>(
      `/config/knowledge/bases/${encodeURIComponent(kbId)}/documents?page=${page}&page_size=${pageSize}`,
    ),

  uploadDocument: async (kbId: string, file: File): Promise<KnowledgeDocument> => {
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch(
      `/config/knowledge/bases/${encodeURIComponent(kbId)}/documents`,
      {
        method: "POST",
        body: form,
        cache: "no-store",
        headers: mergeTraceHeaders(apiHeaders()),
      },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error((err as { detail?: string }).detail ?? `HTTP ${resp.status}`);
    }
    return resp.json();
  },

  deleteDocument: (kbId: string, docId: string) =>
    request<void>(
      `/config/knowledge/bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`,
      { method: "DELETE" },
    ),

  getDocument: (kbId: string, docId: string) =>
    request<KnowledgeDocument>(
      `/config/knowledge/bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`,
    ),

  downloadDocument: async (kbId: string, docId: string, filename: string): Promise<void> => {
    const resp = await fetch(
      `/config/knowledge/bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}/download`,
      { cache: "no-store", headers: mergeTraceHeaders(apiHeaders()) },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error((err as { detail?: string }).detail ?? `HTTP ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  },

  getWikiGraphByDoc: (docId: string, knowledgeIds?: string[]) =>
    request<WikiDocumentGraph>("/config/knowledge/wiki/graph/by_doc", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ doc_id: docId, knowledge_ids: knowledgeIds }),
    }),

  getWikiNodeDetail: (nodeId: string, knowledgeIds?: string[]) =>
    request<WikiNodeDetailResponse>("/config/knowledge/wiki/nodes/detail", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ node_id: nodeId, knowledge_ids: knowledgeIds }),
    }),
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function docStatusLabel(status: KnowledgeDocument["status"]): string {
  const map: Record<KnowledgeDocument["status"], string> = {
    uploaded: "已上传",
    processing: "处理中",
    indexed: "已索引",
    failed: "失败",
  };
  return map[status];
}
