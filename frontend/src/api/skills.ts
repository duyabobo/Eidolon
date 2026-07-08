export type SkillScope = "system" | "user";

export interface Skill {
  name: string;
  description: string;
  scope?: SkillScope;
  user_id?: string | null;
  content?: string;
  tags?: string[];
  hidden?: boolean;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${resp.status}`);
  }
  return resp.json();
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
    const qs = userId?.trim() ? `?user_id=${encodeURIComponent(userId.trim())}` : "";
    return request<{ name: string; raw: string }>(`/skills/${encodeURIComponent(name)}/content${qs}`);
  },

  delete: (name: string) =>
    fetch(`/config/skills/${encodeURIComponent(name)}`, { method: "DELETE" }),
};
