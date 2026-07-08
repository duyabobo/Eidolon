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
