import type { McpServerItem, McpServerStatus } from "../api/mcp";
import { mcpServerStatusKey } from "./McpServerUi";

export function buildStatusMap(servers: McpServerStatus[]): Record<string, McpServerStatus> {
  const next: Record<string, McpServerStatus> = {};
  for (const item of servers) {
    next[mcpServerStatusKey(item.scope, item.name)] = item;
  }
  return next;
}

export function mergeStatus(
  prev: Record<string, McpServerStatus>,
  item: McpServerStatus,
): Record<string, McpServerStatus> {
  return { ...prev, [mcpServerStatusKey(item.scope, item.name)]: item };
}

export function serverStatusKey(server: McpServerItem): string {
  return mcpServerStatusKey(server.scope, server.name);
}
