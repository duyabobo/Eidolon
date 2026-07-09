export interface SkillDraft {
  name: string;
  description: string;
  content: string;
  tags?: string[];
}

export interface SkillCreatorMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export interface SkillCreatorSession {
  id: string;
  user_id?: string | null;
  messages: SkillCreatorMessage[];
  draft: SkillDraft | null;
  created_at?: string;
  updated_at?: string;
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

function withUserQuery(userId?: string) {
  return userId?.trim() ? `?user_id=${encodeURIComponent(userId.trim())}` : "";
}

export const skillCreatorApi = {
  /** 获取或创建会话。forceNew=true 时强制新建（新建对话按钮使用）。*/
  openSession: (userId?: string, forceNew = false) => {
    const params = new URLSearchParams();
    if (userId?.trim()) params.set("user_id", userId.trim());
    if (forceNew) params.set("force_new", "true");
    const qs = params.toString() ? `?${params.toString()}` : "";
    return request<SkillCreatorSession>(`/config/skills/creator/sessions${qs}`, { method: "POST" });
  },

  getSession: (sessionId: string) =>
    request<SkillCreatorSession>(`/config/skills/creator/sessions/${encodeURIComponent(sessionId)}`),

  sendMessage: (sessionId: string, content: string, signal?: AbortSignal) =>
    request<{ message: SkillCreatorMessage; draft: SkillDraft | null }>(
      `/config/skills/creator/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: "POST", body: JSON.stringify({ content }), signal },
    ),

  publish: (sessionId: string, payload: Partial<SkillDraft> & { hidden?: boolean } = {}) =>
    request<{ name: string; description: string; tags?: string[]; hidden?: boolean; user_id?: string | null }>(
      `/config/skills/creator/sessions/${encodeURIComponent(sessionId)}/publish`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
};
