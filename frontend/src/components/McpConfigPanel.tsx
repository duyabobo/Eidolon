import { useEffect, useState } from "react";
import { configApi, McpServerConfig } from "../api/config";
import type { McpServerItem } from "../api/mcp";
import { McpEditModal, McpServerRow } from "./McpServerUi";
import { serverStatusKey } from "./mcpManagerUtils";
import { useMcpManager } from "./useMcpManager";

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
  const {
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
  } = useMcpManager({ userId, includeDisabled: true });

  const [edit, setEdit] = useState<EditState | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (server: McpServerItem) => {
    const label = server.scope === "system" ? "系统" : "个人";
    if (!confirm(`确认删除${label} MCP "${server.name}"？`)) return;
    try {
      await deleteServer(server);
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
    try {
      await saveServer(edit.scope, edit.name.trim(), edit.config);
      setEdit(null);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "保存失败");
    }
  };

  const handleToggleEnabled = async (server: McpServerItem, enabled: boolean) => {
    try {
      await toggleEnabled(server, enabled);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "更新失败");
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

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-500">
          含已禁用 Server；可用性需手动测试后刷新 tool 列表
        </p>
        <button
          type="button"
          onClick={() => void probeAll()}
          disabled={probingAll || servers.length === 0}
          className="text-xs px-3 py-1.5 border border-sky-200 rounded-lg text-sky-700 hover:bg-sky-50 disabled:opacity-50 shrink-0"
        >
          {probingAll ? "测试中…" : "测试全部"}
        </button>
      </div>

      <div className="space-y-2">
        {servers.length === 0 && (
          <p className="text-sm text-ink-400 text-center py-8 border border-dashed border-ink-200 rounded-xl">
            暂无 MCP Server
          </p>
        )}
        {servers.map((server) => {
          const key = serverStatusKey(server);
          return (
            <McpServerRow
              key={key}
              server={server}
              status={statusMap[key]}
              probing={probingKeys.has(key)}
              toolsExpanded={expandedToolKeys.has(key)}
              scopeBadge={<ScopeBadge scope={server.scope} />}
              onToggleEnabled={(enabled) => void handleToggleEnabled(server, enabled)}
              onProbe={() => void probeOne(server)}
              onToggleTools={() => toggleExpandedTools(key)}
              onEdit={() => (server.scope === "system" ? void openSystemEdit(server) : openUserEdit(server))}
              onDelete={() => void handleDelete(server)}
            />
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
