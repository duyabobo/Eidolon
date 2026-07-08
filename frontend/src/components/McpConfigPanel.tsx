import { useCallback, useEffect, useState } from "react";
import { configApi, McpServerConfig } from "../api/config";
import { mcpApi, McpServerItem, McpServerStatus } from "../api/mcp";
import { McpEditModal, McpServerStatusBadge, mcpServerStatusKey } from "./McpServerUi";

const EMPTY_SERVER: McpServerConfig = { url: "", description: "", enabled: true, api_key: "" };

type EditState = {
  scope: "system" | "user";
  name: string;
  config: McpServerConfig;
  isNew: boolean;
};

interface Props {
  userId: string;
}

function ScopeBadge({ scope }: { scope: "system" | "user" }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
      scope === "user" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
    }`}>
      {scope === "user" ? "我的" : "系统"}
    </span>
  );
}

export default function McpConfigPanel({ userId }: Props) {
  const [servers, setServers] = useState<McpServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [statusMap, setStatusMap] = useState<Record<string, McpServerStatus>>({});
  const [edit, setEdit] = useState<EditState | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setProbing(true);
    try {
      const res = await mcpApi.getServerStatus(userId.trim() || undefined);
      const next: Record<string, McpServerStatus> = {};
      for (const item of res.servers) {
        next[mcpServerStatusKey(item.scope, item.name)] = item;
      }
      setStatusMap(next);
    } catch {
      setStatusMap({});
    } finally {
      setProbing(false);
    }
  }, [userId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await mcpApi.listForChat(userId.trim() || undefined);
      setServers(list);
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void (async () => {
      await load();
      await refreshStatus();
    })();
  }, [load, refreshStatus]);

  const handleDeleteSystem = async (name: string) => {
    if (!confirm(`确认删除系统 MCP "${name}"？`)) return;
    setErrMsg(null);
    try {
      await configApi.deleteServer(name);
      await load();
      await refreshStatus();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleDeleteUser = async (name: string) => {
    if (!userId.trim()) return;
    if (!confirm(`确认删除个人 MCP "${name}"？`)) return;
    setErrMsg(null);
    try {
      await mcpApi.deleteUserServer(userId.trim(), name);
      await load();
      await refreshStatus();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "删除失败");
    }
  };

  const openSystemEdit = async (server: McpServerItem) => {
    try {
      const full = await configApi.getMcp();
      const cfg = full.servers[server.name] ?? {
        url: server.url,
        description: server.description,
        enabled: server.enabled,
        api_key: "",
      };
      setEdit({
        scope: "system",
        name: server.name,
        isNew: false,
        config: { ...cfg, api_key: cfg.api_key ?? "" },
      });
    } catch {
      setEdit({
        scope: "system",
        name: server.name,
        isNew: false,
        config: {
          url: server.url,
          description: server.description,
          enabled: server.enabled,
          api_key: "",
        },
      });
    }
  };

  const openUserEdit = (server: McpServerItem) => {
    setEdit({
      scope: "user",
      name: server.name,
      isNew: false,
      config: {
        url: server.url,
        description: server.description ?? "",
        enabled: server.enabled !== false,
        api_key: "",
      },
    });
  };

  const openUserCreate = () => {
    if (!userId.trim()) {
      setErrMsg("请先在「历史」页设置用户 ID");
      return;
    }
    setEdit({
      scope: "user",
      name: "",
      isNew: true,
      config: { ...EMPTY_SERVER },
    });
  };

  const handleSaveEdit = async () => {
    if (!edit) return;
    if (!edit.name.trim()) {
      setErrMsg("名称不能为空");
      return;
    }
    if (!edit.config.url?.trim()) {
      setErrMsg("URL 不能为空");
      return;
    }
    setErrMsg(null);
    try {
      if (edit.scope === "system") {
        await configApi.addServer(edit.name.trim(), edit.config);
      } else {
        if (!userId.trim()) {
          setErrMsg("请先在「历史」页设置用户 ID");
          return;
        }
        await mcpApi.addUserServer(userId.trim(), edit.name.trim(), edit.config);
      }
      setEdit(null);
      await load();
      await refreshStatus();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "保存失败");
    }
  };

  if (loading) return <div className="text-sm text-ink-400">加载中…</div>;

  return (
    <div className="space-y-4">
      {errMsg && (
        <p className="text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700">
          {errMsg}
        </p>
      )}

      <div className="space-y-2">
        {servers.length === 0 && (
          <p className="text-sm text-ink-400 text-center py-8 border border-dashed border-ink-200 rounded-xl">
            暂无 MCP Server
          </p>
        )}
        {servers.map((server) => {
          const statusKey = mcpServerStatusKey(server.scope, server.name);
          return (
            <div
              key={statusKey}
              className="flex items-center gap-3 border border-ink-200/60 rounded-xl px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <ScopeBadge scope={server.scope} />
                  <span className="text-sm font-medium text-ink-800">{server.name}</span>
                  {server.enabled === false && (
                    <span className="text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded">已禁用</span>
                  )}
                  {server.has_api_key && (
                    <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">已配置 API Key</span>
                  )}
                  <McpServerStatusBadge statusKey={statusKey} statusMap={statusMap} probing={probing} />
                </div>
                <p className="text-xs text-ink-400 truncate mt-0.5">{server.url}</p>
                {server.description && <p className="text-xs text-ink-400 mt-0.5">{server.description}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => (server.scope === "system" ? void openSystemEdit(server) : openUserEdit(server))}
                  className="text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => (server.scope === "system"
                    ? handleDeleteSystem(server.name)
                    : handleDeleteUser(server.name))}
                  className="text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50"
                >
                  删除
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={openUserCreate}
        className="w-full py-2.5 border-2 border-dashed border-emerald-300/80 text-emerald-700 text-sm rounded-xl hover:bg-emerald-50/50 transition-colors"
      >
        + 添加个人 MCP
      </button>

      {edit && (
        <McpEditModal
          title={
            edit.isNew
              ? "添加个人 MCP"
              : edit.scope === "system"
                ? `编辑系统 MCP · ${edit.name}`
                : `编辑个人 MCP · ${edit.name}`
          }
          name={edit.name}
          nameReadonly={!edit.isNew}
          onNameChange={(name) => setEdit({ ...edit, name })}
          config={edit.config}
          onChange={(patch) => setEdit({ ...edit, config: { ...edit.config, ...patch } })}
          onSave={() => void handleSaveEdit()}
          onCancel={() => setEdit(null)}
        />
      )}
    </div>
  );
}
