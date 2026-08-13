import { apiFetch, mergeTraceHeaders } from "./http";

export type SkillScope = "system" | "user";

export interface Skill {
  name: string;
  description: string;
  scope?: SkillScope;
  user_id?: string | null;
  content?: string;
  tags?: string[];
  hidden?: boolean;
  /** 空=对话创建；github=GitHub 导入（不可对话编辑） */
  source?: string;
}

export interface SkillTreeEntry {
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
}

export interface SkillTreeResponse {
  name: string;
  user_id: string | null;
  entries: SkillTreeEntry[];
}

export interface GithubSkillImportResult {
  name: string;
  description: string;
  scope: string;
  copied_entries: string[];
  source: {
    owner: string;
    repo: string;
    ref: string;
    subdir: string;
    url: string;
  };
}

async function parseError(resp: Response): Promise<string> {
  const err = await resp.json().catch(() => ({}));
  const detail = (err as { detail?: string | { msg?: string }[] }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  return `HTTP ${resp.status}`;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const resp = await apiFetch(url, options);
  if (!resp.ok) throw new Error(await parseError(resp));
  if (resp.status === 204) return undefined as T;
  return resp.json();
}

function skillQs(userId?: string): string {
  return userId?.trim() ? `?user_id=${encodeURIComponent(userId.trim())}` : "";
}

function skillFileUrl(
  name: string,
  path: string,
  userId?: string,
  extra?: Record<string, string>,
): string {
  const qs = new URLSearchParams({ path });
  if (userId?.trim()) qs.set("user_id", userId.trim());
  if (extra) {
    for (const [k, v] of Object.entries(extra)) qs.set(k, v);
  }
  return `/config/skills/${encodeURIComponent(name)}/files?${qs}`;
}

export function toSkillRef(scope: SkillScope, name: string): string {
  return scope === "system" ? `global:${name}` : `user:${name}`;
}

export const skillsApi = {
  listForChat: (userId?: string) => {
    const qs = userId?.trim() ? `?user_id=${encodeURIComponent(userId.trim())}` : "";
    return request<Skill[]>(`/skills${qs}`);
  },

  listAdmin: () => request<Skill[]>("/config/skills"),

  getContent: (name: string, userId?: string) => {
    const qs = skillQs(userId);
    return request<{ name: string; raw: string }>(`/skills/${encodeURIComponent(name)}/content${qs}`);
  },

  getTree: (name: string, userId?: string) =>
    request<SkillTreeResponse>(`/config/skills/${encodeURIComponent(name)}/tree${skillQs(userId)}`),

  fetchFileText: async (name: string, path: string, userId?: string): Promise<string> => {
    const resp = await fetch(skillFileUrl(name, path, userId, { as_text: "true", disposition: "inline" }), {
      cache: "no-store",
      headers: mergeTraceHeaders(),
    });
    if (!resp.ok) throw new Error(await parseError(resp));
    return resp.text();
  },

  fetchFileBlob: async (name: string, path: string, userId?: string): Promise<Blob> => {
    const resp = await fetch(skillFileUrl(name, path, userId, { disposition: "inline" }), {
      cache: "no-store",
      headers: mergeTraceHeaders(),
    });
    if (!resp.ok) throw new Error(await parseError(resp));
    return resp.blob();
  },

  downloadFile: async (name: string, path: string, filename: string, userId?: string): Promise<void> => {
    const resp = await fetch(skillFileUrl(name, path, userId, { disposition: "attachment" }), {
      cache: "no-store",
      headers: mergeTraceHeaders(),
    });
    if (!resp.ok) throw new Error(await parseError(resp));
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  importFromGithub: (body: {
    github_url: string;
    user_id: string;
    ref?: string;
    subdir?: string;
    overwrite?: boolean;
  }) =>
    request<GithubSkillImportResult>("/config/skills/import-from-github", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  delete: (name: string, userId?: string) => {
    const qs = skillQs(userId);
    return request<void>(`/config/skills/${encodeURIComponent(name)}${qs}`, { method: "DELETE" });
  },
};
