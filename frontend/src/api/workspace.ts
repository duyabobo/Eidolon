import { mergeTraceHeaders, request, throwIfNotOk } from "./http";
import { downloadBlob } from "../utils/download";

export interface WorkspaceEntry {
  name: string;
  display_name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mtime: string | null;
  readonly: boolean;
  doc_id?: string | null;
  kb_id?: string | null;
  wiki_compiled?: boolean;
  knowledge_status?: string | null;
}

export interface WorkspaceListResponse {
  path: string;
  writable: boolean;
  entries: WorkspaceEntry[];
}

export interface ChatUploadResponse {
  filename: string;
  relative_path: string;
  stored_path: string;
  size: number;
  doc_id: string;
  kb_id: string;
  knowledge_status: string;
}

function withPath(path?: string): string {
  const qs = new URLSearchParams();
  if (path !== undefined) qs.set("path", path);
  return qs.toString();
}

export const workspaceApi = {
  ls: (path = "") =>
    request<WorkspaceListResponse>(`/config/workspace/ls?${withPath(path)}`),

  mkdir: (path: string) =>
    request<WorkspaceListResponse>(`/config/workspace/mkdir`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  upload: async (dirPath: string, file: File): Promise<WorkspaceListResponse> => {
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch(
      `/config/workspace/upload?${withPath(dirPath)}`,
      {
        method: "POST",
        body: form,
        cache: "no-store",
        headers: mergeTraceHeaders(),
      },
    );
    await throwIfNotOk(resp);
    return resp.json();
  },

  delete: (path: string) =>
    request<void>(`/config/workspace/entry?${withPath(path)}`, {
      method: "DELETE",
    }),

  fetchBlob: async (
    path: string,
    disposition: "inline" | "attachment" = "inline",
  ): Promise<Blob> => {
    const qs = new URLSearchParams({ path, disposition });
    const resp = await fetch(`/config/workspace/download?${qs}`, {
      cache: "no-store",
      headers: mergeTraceHeaders(),
    });
    await throwIfNotOk(resp);
    return resp.blob();
  },

  fetchText: async (path: string): Promise<string> => {
    const blob = await workspaceApi.fetchBlob(path, "inline");
    return blob.text();
  },

  download: async (path: string, filename: string): Promise<void> => {
    const blob = await workspaceApi.fetchBlob(path, "attachment");
    downloadBlob(blob, filename);
  },

  /** 首页会话附件 → session workspace + knowledge 入库（返回 doc_id） */
  uploadToSession: async (
    sessionId: string,
    file: File,
  ): Promise<ChatUploadResponse> => {
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch(
      `/sessions/${encodeURIComponent(sessionId)}/upload`,
      {
        method: "POST",
        body: form,
        cache: "no-store",
        headers: mergeTraceHeaders(),
      },
    );
    await throwIfNotOk(resp);
    return resp.json();
  },
};
