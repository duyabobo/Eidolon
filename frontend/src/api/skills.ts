import { mergeTraceHeaders, request, throwIfNotOk } from "./http";
import { downloadBlob } from "../utils/download";

export type SkillScope = "system" | "user";

export interface Skill {
  name: string;
  description: string;
  scope?: SkillScope;
  user_id?: string | null;
  content?: string;
  tags?: string[];
  hidden?: boolean;
  /** 空=对话创建/已归自己；github=GitHub 导入（可编辑，发布后清空） */
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

function skillQs(scope?: SkillScope): string {
  return scope === "user" ? "?scope=user" : "";
}

function skillFileUrl(
  name: string,
  path: string,
  scope?: SkillScope,
  extra?: Record<string, string>,
): string {
  const qs = new URLSearchParams({ path });
  if (scope === "user") qs.set("scope", "user");
  if (extra) {
    for (const [k, v] of Object.entries(extra)) qs.set(k, v);
  }
  return `/config/skills/${encodeURIComponent(name)}/files?${qs}`;
}

export function toSkillRef(scope: SkillScope, name: string): string {
  return scope === "system" ? `global:${name}` : `user:${name}`;
}

export const skillsApi = {
  listForChat: () => request<Skill[]>("/skills"),

  listAdmin: () => request<Skill[]>("/config/skills"),

  getContent: (name: string, scope?: SkillScope) =>
    request<{ name: string; raw: string }>(
      `/skills/${encodeURIComponent(name)}/content${skillQs(scope)}`,
    ),

  getTree: (name: string, scope?: SkillScope) =>
    request<SkillTreeResponse>(`/config/skills/${encodeURIComponent(name)}/tree${skillQs(scope)}`),

  fetchFileText: async (name: string, path: string, scope?: SkillScope): Promise<string> => {
    const resp = await fetch(skillFileUrl(name, path, scope, { as_text: "true", disposition: "inline" }), {
      cache: "no-store",
      headers: mergeTraceHeaders(),
    });
    await throwIfNotOk(resp);
    return resp.text();
  },

  fetchFileBlob: async (name: string, path: string, scope?: SkillScope): Promise<Blob> => {
    const resp = await fetch(skillFileUrl(name, path, scope, { disposition: "inline" }), {
      cache: "no-store",
      headers: mergeTraceHeaders(),
    });
    await throwIfNotOk(resp);
    return resp.blob();
  },

  downloadFile: async (name: string, path: string, filename: string, scope?: SkillScope): Promise<void> => {
    const resp = await fetch(skillFileUrl(name, path, scope, { disposition: "attachment" }), {
      cache: "no-store",
      headers: mergeTraceHeaders(),
    });
    await throwIfNotOk(resp);
    const blob = await resp.blob();
    downloadBlob(blob, filename);
  },

  delete: (name: string, scope?: SkillScope) =>
    request<void>(`/config/skills/${encodeURIComponent(name)}${skillQs(scope)}`, { method: "DELETE" }),
};
