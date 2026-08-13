import { useCallback, useState } from "react";
import type { McpScope, McpServerConfig, McpServerItem, McpServerStatus } from "../api/mcp";
import { mcpApi } from "../api/mcp";
import { configApi } from "../api/config";
import { buildStatusMap, mergeStatus, serverStatusKey } from "./mcpManagerUtils";

interface UseMcpManagerOptions {
  userId: string;
  includeDisabled?: boolean;
}

export function useMcpManager({ userId, includeDisabled = true }: UseMcpManagerOptions) {
  const [servers, setServers] = useState<McpServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [probingAll, setProbingAll] = useState(false);
  const [probingKeys, setProbingKeys] = useState<Set<string>>(new Set());
  const [statusMap, setStatusMap] = useState<Record<string, McpServerStatus>>({});
  const [expandedToolKeys, setExpandedToolKeys] = useState<Set<string>>(new Set());
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await mcpApi.listServers(userId.trim() || undefined, includeDisabled);
      setServers(list);
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, [userId, includeDisabled]);

  const probeAll = useCallback(async () => {
    setProbingAll(true);
    setErrMsg(null);
    try {
      const res = await mcpApi.getServerStatus(userId.trim() || undefined, includeDisabled);
      setStatusMap(buildStatusMap(res.servers));
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "探测失败");
    } finally {
      setProbingAll(false);
    }
  }, [userId, includeDisabled]);

  const probeOne = useCallback(async (server: McpServerItem) => {
    const key = serverStatusKey(server);
    setProbingKeys((prev) => new Set(prev).add(key));
    setErrMsg(null);
    try {
      const item = await mcpApi.probeServer(
        server.scope === "user" ? userId.trim() : undefined,
        server.name,
        server.scope,
      );
      setStatusMap((prev) => mergeStatus(prev, item));
      if (item.available && item.tools.length > 0) {
        setExpandedToolKeys((prev) => new Set(prev).add(key));
      }
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "探测失败");
    } finally {
      setProbingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [userId]);

  const toggleExpandedTools = useCallback((key: string) => {
    setExpandedToolKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const saveServer = useCallback(async (
    scope: McpScope,
    name: string,
    config: McpServerConfig,
  ) => {
    setErrMsg(null);
    if (scope === "system") {
      await configApi.addServer(name, config);
    } else {
      if (!userId.trim()) {
        throw new Error("请先在配置页设置用户 ID");
      }
      await mcpApi.addUserServer(userId.trim(), name, config);
    }
    await load();
  }, [userId, load]);

  const toggleEnabled = useCallback(async (server: McpServerItem, enabled: boolean) => {
    setErrMsg(null);
    const config: McpServerConfig = {
      url: server.url,
      description: server.description ?? "",
      enabled,
      api_key: "",
    };
    await saveServer(server.scope, server.name, config);
    const key = serverStatusKey(server);
    if (!enabled) {
      setStatusMap((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setExpandedToolKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [saveServer]);

  const deleteServer = useCallback(async (server: McpServerItem) => {
    setErrMsg(null);
    if (server.scope === "system") {
      await configApi.deleteServer(server.name);
    } else {
      await mcpApi.deleteUserServer(userId.trim(), server.name);
    }
    const key = serverStatusKey(server);
    setStatusMap((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    await load();
  }, [userId, load]);

  return {
    servers,
    loading,
    probingAll,
    probingKeys,
    statusMap,
    expandedToolKeys,
    errMsg,
    setErrMsg,
    load,
    probeAll,
    probeOne,
    toggleExpandedTools,
    saveServer,
    toggleEnabled,
    deleteServer,
  };
}
