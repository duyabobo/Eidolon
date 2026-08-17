import { request } from "./http";
import type { McpServerConfig } from "./types";

export type { McpServerConfig };

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
  listForChat: () =>
    request<McpServerItem[]>(`/mcp${buildQuery({ include_disabled: false })}`),

  /** 配置页：可选包含已禁用 Server */
  listServers: (includeDisabled = true) =>
    request<McpServerItem[]>(
      `/mcp${buildQuery({ include_disabled: includeDisabled })}`,
    ),

  getServerStatus: (includeDisabled = false) =>
    request<McpServerStatusResponse>(
      `/mcp/status${buildQuery({ include_disabled: includeDisabled })}`,
    ),

  probeServer: (name: string, scope: McpScope) =>
    request<McpServerStatus>(
      `/mcp/servers/${encodeURIComponent(name)}/status${buildQuery({ scope })}`,
    ),

  addUserServer: (name: string, cfg: McpServerConfig) =>
    request<McpServerItem>(
      `/mcp/servers/${encodeURIComponent(name)}`,
      { method: "POST", body: JSON.stringify(cfg) },
    ),

  deleteUserServer: (name: string) =>
    request<void>(
      `/mcp/servers/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),
};
