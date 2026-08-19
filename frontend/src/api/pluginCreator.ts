import { mergeTraceHeaders, request } from "./http";

export interface PluginDraft {
  name: string;
  description: string;
  server_py: string;
}

export interface PluginCreatorMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export interface PluginCreatorSession {
  id: string;
  user_id?: string | null;
  messages: PluginCreatorMessage[];
  draft: PluginDraft | null;
  published: boolean;
  plugin_name?: string | null;
}

export const pluginCreatorApi = {
  openSession: (scope?: "user" | "system", forceNew = false, pluginName?: string) => {
    const params = new URLSearchParams();
    if (scope === "user") params.set("scope", "user");
    if (forceNew) params.set("force_new", "true");
    if (pluginName?.trim()) params.set("plugin_name", pluginName.trim());
    const qs = params.toString() ? `?${params.toString()}` : "";
    return request<PluginCreatorSession>(`/config/plugins/creator/sessions${qs}`, { method: "POST" });
  },

  resetSession: (sessionId: string) =>
    request<PluginCreatorSession>(
      `/config/plugins/creator/sessions/${encodeURIComponent(sessionId)}/reset`,
      { method: "POST" },
    ),

  sendMessage: (sessionId: string, content: string, signal?: AbortSignal) =>
    request<{ message: PluginCreatorMessage; draft: PluginDraft | null }>(
      `/config/plugins/creator/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: "POST", body: JSON.stringify({ content }), signal },
    ),

  publish: (sessionId: string, payload: Partial<PluginDraft> = {}) =>
    request<{ name: string; description: string; user_id?: string | null }>(
      `/config/plugins/creator/sessions/${encodeURIComponent(sessionId)}/publish`,
      { method: "POST", body: JSON.stringify(payload) },
    ),

  getTree: (sessionId: string) =>
    request<{ session_id: string; skill_dir: string; entries: Array<{ path: string; name: string; is_dir: boolean; size: number }> }>(
      `/config/plugins/creator/sessions/${encodeURIComponent(sessionId)}/tree`,
    ),

  fetchFileText: async (sessionId: string, path: string): Promise<string> => {
    const qs = new URLSearchParams({ path, as_text: "true", disposition: "inline" });
    const resp = await fetch(
      `/config/plugins/creator/sessions/${encodeURIComponent(sessionId)}/file?${qs}`,
      { cache: "no-store", headers: mergeTraceHeaders() },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error((err as { detail?: string }).detail ?? `HTTP ${resp.status}`);
    }
    return resp.text();
  },

  fetchFileBlob: async (sessionId: string, path: string): Promise<Blob> => {
    const qs = new URLSearchParams({ path, disposition: "inline" });
    const resp = await fetch(
      `/config/plugins/creator/sessions/${encodeURIComponent(sessionId)}/file?${qs}`,
      { cache: "no-store", headers: mergeTraceHeaders() },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error((err as { detail?: string }).detail ?? `HTTP ${resp.status}`);
    }
    return resp.blob();
  },
};
