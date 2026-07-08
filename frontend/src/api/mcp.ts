export type McpScope = "system" | "user";

export interface McpServerItem {
  name: string;
  url: string;
  description?: string;
  enabled?: boolean;
  has_api_key?: boolean;
  scope: McpScope;
  user_id?: string | null;
}

export interface McpServerConfig {
  url: string;
  description?: string;
  enabled?: boolean;
  api_key?: string;
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

export const mcpApi = {
  listForChat: (userId?: string) => {
    const qs = userId?.trim() ? `?user_id=${encodeURIComponent(userId.trim())}` : "";
    return request<McpServerItem[]>(`/mcp${qs}`);
  },

  addUserServer: (userId: string, name: string, cfg: McpServerConfig) =>
    request<McpServerItem>(
      `/mcp/servers/${encodeURIComponent(name)}?user_id=${encodeURIComponent(userId)}`,
      { method: "POST", body: JSON.stringify(cfg) },
    ),

  deleteUserServer: (userId: string, name: string) =>
    fetch(`/mcp/servers/${encodeURIComponent(name)}?user_id=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }),
};
