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
  created_at?: string | null;
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
  connections: Array<Record<string, string>>;
  attachment_oss_url: string;
  created_at: string;
  doc_lang: string;
  score: number | null;
}

export interface WikiNodeDetailResponse {
  node: WikiNodeItem;
  took_ms: number;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${resp.status}`);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json();
}

export const knowledgeApi = {
  getServiceConfig: () => request<KnowledgeServiceConfig>("/config/knowledge/service"),

  saveServiceConfig: (cfg: KnowledgeServiceConfig) =>
    request<KnowledgeServiceConfig>("/config/knowledge/service", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    }),

  listBases: (page = 1, pageSize = 20) =>
    request<KnowledgeBaseList>(`/config/knowledge/bases?page=${page}&page_size=${pageSize}`),

  createBase: (body: {
    name: string;
    description?: string;
    type?: "document" | "multimodal";
    chunking_config?: ChunkingConfig;
  }) =>
    request<KnowledgeBase>("/config/knowledge/bases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  updateBase: (kbId: string, body: { name?: string; description?: string; chunking_config?: ChunkingConfig }) =>
    request<KnowledgeBase>(`/config/knowledge/bases/${encodeURIComponent(kbId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
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
      { method: "POST", body: form },
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

  downloadUrl: (kbId: string, docId: string) =>
    `/config/knowledge/bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}/download`,

  getWikiGraphByDoc: (docId: string, knowledgeIds?: string[]) =>
    request<WikiDocumentGraph>("/config/knowledge/wiki/graph/by_doc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_id: docId, knowledge_ids: knowledgeIds }),
    }),

  getWikiNodeDetail: (nodeId: string, knowledgeIds?: string[]) =>
    request<WikiNodeDetailResponse>("/config/knowledge/wiki/nodes/detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
