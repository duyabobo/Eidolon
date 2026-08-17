import { request } from "./http";
import type { McpServerConfig, ServiceTestResult } from "./types";

export type { McpServerConfig, ServiceTestResult };

export interface LlmConfig {
  base_url: string;
  api_key: string;
  model: string;
  timeout: number;
  protocol: "openai" | "anthropic";
}

export interface LlmProfile extends LlmConfig {
  id: string;
  name: string;
}

export interface LlmProfileCreate {
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  timeout: number;
  protocol: "openai" | "anthropic";
}

export interface LlmProfileUpdate {
  name?: string;
  base_url?: string;
  api_key?: string;
  model?: string;
  timeout?: number;
  protocol?: "openai" | "anthropic";
}

export interface LlmProfileListResponse {
  items: LlmProfile[];
  active_id: string | null;
}

export interface IntentLlmConfig {
  base_url: string;
  api_key: string;
  model: string;
  timeout?: number;
  protocol?: "openai" | "anthropic";
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export interface DeviceInfo {
  user_id: string;
}

export const configApi = {
  getDevice: () => request<DeviceInfo>("/config/device"),

  getLlm: () => request<LlmConfig>("/config/llm"),

  listLlmProfiles: () => request<LlmProfileListResponse>("/config/llm/profiles"),

  createLlmProfile: (body: LlmProfileCreate) =>
    request<LlmProfile>("/config/llm/profiles", { method: "POST", body: JSON.stringify(body) }),

  updateLlmProfile: (id: string, body: LlmProfileUpdate) =>
    request<LlmProfile>(`/config/llm/profiles/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteLlmProfile: (id: string) =>
    request<void>(`/config/llm/profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),

  activateLlmProfile: (id: string) =>
    request<LlmConfig>(`/config/llm/profiles/${encodeURIComponent(id)}/activate`, { method: "PUT" }),

  getIntentLlm: () => request<IntentLlmConfig>("/config/llm/intent"),

  saveIntentLlm: (cfg: IntentLlmConfig) =>
    request<IntentLlmConfig>("/config/llm/intent", {
      method: "PUT",
      body: JSON.stringify(cfg),
    }),

  testIntentLlm: (cfg: IntentLlmConfig) =>
    request<ServiceTestResult>("/config/llm/intent/test", {
      method: "POST",
      body: JSON.stringify(cfg),
    }),

  testLlmProfile: (id: string) =>
    request<ServiceTestResult>(`/config/llm/profiles/${encodeURIComponent(id)}/test`, { method: "POST" }),

  getMcp: () => request<McpConfig>("/config/mcp"),
  saveMcp: (cfg: McpConfig) =>
    request<McpConfig>("/config/mcp", { method: "PUT", body: JSON.stringify(cfg) }),
  addServer: (name: string, cfg: McpServerConfig) =>
    request<McpConfig>(`/config/mcp/servers/${encodeURIComponent(name)}`, {
      method: "POST",
      body: JSON.stringify(cfg),
    }),
  deleteServer: (name: string) =>
    request<McpConfig>(`/config/mcp/servers/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
};
