import { mergeTraceHeaders } from "./http";

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

async function parseError(resp: Response): Promise<string> {
  const err = await resp.json().catch(() => ({}));
  const detail = (err as { detail?: string | { msg?: string }[] }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  return `HTTP ${resp.status}`;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: mergeTraceHeaders(options?.headers, { json: true }),
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  if (resp.status === 204) return undefined as T;
  return resp.json();
}

function withUser(userId: string, path?: string): string {
  const qs = new URLSearchParams({ user_id: userId.trim() });
  if (path !== undefined) qs.set("path", path);
  return qs.toString();
}

export const workspaceApi = {
  ls: (userId: string, path = "") =>
    request<WorkspaceListResponse>(`/config/workspace/ls?${withUser(userId, path)}`),

  mkdir: (userId: string, path: string) =>
    request<WorkspaceListResponse>(`/config/workspace/mkdir?${withUser(userId)}`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  upload: async (userId: string, dirPath: string, file: File): Promise<WorkspaceListResponse> => {
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch(
      `/config/workspace/upload?${withUser(userId, dirPath)}`,
      {
        method: "POST",
        body: form,
        cache: "no-store",
        headers: mergeTraceHeaders(),
      },
    );
    if (!resp.ok) throw new Error(await parseError(resp));
    return resp.json();
  },

  delete: (userId: string, path: string) =>
    request<void>(`/config/workspace/entry?${withUser(userId, path)}`, {
      method: "DELETE",
    }),

  fetchBlob: async (
    userId: string,
    path: string,
    disposition: "inline" | "attachment" = "inline",
  ): Promise<Blob> => {
    const qs = new URLSearchParams({
      user_id: userId.trim(),
      path,
      disposition,
    });
    const resp = await fetch(`/config/workspace/download?${qs}`, {
      cache: "no-store",
      headers: mergeTraceHeaders(),
    });
    if (!resp.ok) throw new Error(await parseError(resp));
    return resp.blob();
  },

  fetchText: async (userId: string, path: string): Promise<string> => {
    const blob = await workspaceApi.fetchBlob(userId, path, "inline");
    return blob.text();
  },

  download: async (userId: string, path: string, filename: string): Promise<void> => {
    const blob = await workspaceApi.fetchBlob(userId, path, "attachment");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** 首页会话附件 → session workspace + knowledge 入库（返回 doc_id） */
  uploadToSession: async (
    userId: string,
    sessionId: string,
    file: File,
  ): Promise<ChatUploadResponse> => {
    const form = new FormData();
    form.append("file", file);
    const qs = new URLSearchParams({ user_id: userId.trim() });
    const resp = await fetch(
      `/sessions/${encodeURIComponent(sessionId)}/upload?${qs}`,
      {
        method: "POST",
        body: form,
        cache: "no-store",
        headers: mergeTraceHeaders(),
      },
    );
    if (!resp.ok) throw new Error(await parseError(resp));
    return resp.json();
  },
};
