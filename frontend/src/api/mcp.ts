import { apiFetch } from "./http";

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

export interface McpServerStatus {
  name: string;
  scope: McpScope;
  url: string;
  enabled?: boolean;
  available: boolean;
  tool_count: number;
  tools: string[];
  error?: string;
  latency_ms?: number;
  skipped?: boolean;
}

export interface McpServerStatusResponse {
  servers: McpServerStatus[];
}

export interface McpServerConfig {
  url: string;
  description?: string;
  enabled?: boolean;
  api_key?: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const resp = await apiFetch(url, options);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${resp.status}`);
  }
  return resp.json();
}

function buildQuery(params: Record<string, string | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    q.set(key, String(value));
  }
  const serialized = q.toString();
  return serialized ? `?${serialized}` : "";
}

export const mcpApi = {
  /** 对话场景：仅返回已启用的 Server */
  listForChat: (userId?: string) =>
    request<McpServerItem[]>(
      `/mcp${buildQuery({ user_id: userId?.trim(), include_disabled: false })}`,
    ),

  /** 配置页：可选包含已禁用 Server */
  listServers: (userId?: string, includeDisabled = true) =>
    request<McpServerItem[]>(
      `/mcp${buildQuery({ user_id: userId?.trim(), include_disabled: includeDisabled })}`,
    ),

  getServerStatus: (userId?: string, includeDisabled = false) =>
    request<McpServerStatusResponse>(
      `/mcp/status${buildQuery({ user_id: userId?.trim(), include_disabled: includeDisabled })}`,
    ),

  probeServer: (userId: string | undefined, name: string, scope: McpScope) =>
    request<McpServerStatus>(
      `/mcp/servers/${encodeURIComponent(name)}/status${buildQuery({
        user_id: userId?.trim(),
        scope,
      })}`,
    ),

  addUserServer: (userId: string, name: string, cfg: McpServerConfig) =>
    request<McpServerItem>(
      `/mcp/servers/${encodeURIComponent(name)}?user_id=${encodeURIComponent(userId)}`,
      { method: "POST", body: JSON.stringify(cfg) },
    ),

  deleteUserServer: (userId: string, name: string) =>
    apiFetch(`/mcp/servers/${encodeURIComponent(name)}?user_id=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }),
};
