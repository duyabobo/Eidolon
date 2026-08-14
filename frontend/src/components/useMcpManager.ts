import { useCallback, useEffect, useRef, useState } from "react";
import type { McpScope, McpServerConfig, McpServerItem, McpServerStatus } from "../api/mcp";
import { mcpApi } from "../api/mcp";
import { configApi } from "../api/config";
import { mergeStatus, serverStatusKey } from "./mcpManagerUtils";

interface UseMcpManagerOptions {
  userId: string;
  includeDisabled?: boolean;
}

export function useMcpManager({ userId, includeDisabled = true }: UseMcpManagerOptions) {
  const [servers, setServers] = useState<McpServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [probingKeys, setProbingKeys] = useState<Set<string>>(new Set());
  const [statusMap, setStatusMap] = useState<Record<string, McpServerStatus>>({});
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const includeDisabledRef = useRef(includeDisabled);
  includeDisabledRef.current = includeDisabled;

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const list = await mcpApi.listServers(
        userId.trim() || undefined,
        includeDisabledRef.current,
      );
      setServers(list);
    } catch {
      setServers([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [userId]);

  // 仅在 userId 变化时拉取；勿把 load 放进 deps，避免身份抖动导致每秒重打 /mcp
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void mcpApi
      .listServers(userId.trim() || undefined, includeDisabledRef.current)
      .then((list) => {
        if (!cancelled) setServers(list);
      })
      .catch(() => {
        if (!cancelled) setServers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

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
    await load({ silent: true });
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
    await load({ silent: true });
  }, [userId, load]);

  return {
    servers,
    loading,
    probingKeys,
    statusMap,
    errMsg,
    setErrMsg,
    load,
    probeOne,
    saveServer,
    toggleEnabled,
    deleteServer,
  };
}
