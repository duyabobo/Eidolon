/**
 * 每轮意图策略：gateway 分流后写入沙盒，bwrap / MCP 桥按此收工具。
 * 缺省（旧派发无 turn_policy）= 不限制，保持兼容。
 */
import { writeFile } from "fs/promises";
import { join } from "path";

export const TURN_POLICY_FILENAME = "turn-policy.json";

export type McpMode = "all" | "none" | "allow";

export interface TurnPolicy {
  intent: string;
  reason: string;
  allowBuiltin: string[] | null;
  mcpMode: McpMode;
  allowMcp: string[];
}

export function parseTurnPolicy(raw: unknown): TurnPolicy | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const mcpMode = body.mcp_mode;
  if (mcpMode !== "all" && mcpMode !== "none" && mcpMode !== "allow") {
    return null;
  }
  const allowBuiltin = Array.isArray(body.allow_builtin)
    ? body.allow_builtin.map(String)
    : null;
  const allowMcp = Array.isArray(body.allow_mcp) ? body.allow_mcp.map(String) : [];
  return {
    intent: String(body.intent || ""),
    reason: String(body.reason || ""),
    allowBuiltin,
    mcpMode,
    allowMcp,
  };
}

export async function writeTurnPolicyFile(piConfigDir: string, policy: TurnPolicy | null): Promise<void> {
  const path = join(piConfigDir, TURN_POLICY_FILENAME);
  if (!policy) {
    await writeFile(path, JSON.stringify({ allow_builtin: null }), "utf8");
    return;
  }
  await writeFile(
    path,
    JSON.stringify({
      intent: policy.intent,
      allow_builtin: policy.allowBuiltin,
    }),
    "utf8",
  );
}
