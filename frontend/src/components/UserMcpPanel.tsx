import { useEffect, useState } from "react";
import type { McpServerConfig, McpServerItem } from "../api/mcp";
import { McpEditModal, McpServerRow } from "./McpServerUi";
import { serverStatusKey } from "./mcpManagerUtils";
import { useMcpManager } from "./useMcpManager";

const EMPTY: McpServerConfig = { url: "", description: "", enabled: true, api_key: "" };

type EditState = {
  name: string;
  config: McpServerConfig;
  isNew: boolean;
};

interface Props {
  userId: string;
  onClose?: () => void;
  embedded?: boolean;
}

export default function UserMcpPanel({ userId, onClose, embedded = false }: Props) {
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

  const userServers = servers.filter((s) => s.scope === "user");
  const systemServers = servers.filter((s) => s.scope === "system");

  const handleSave = async () => {
    if (!edit) return;
    if (!edit.name.trim() || !edit.config.url?.trim()) {
      setErrMsg("名称和 URL 不能为空");
      return;
    }
    try {
      await saveServer("user", edit.name.trim(), edit.config);
      setEdit(null);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "保存失败");
    }
  };

  const handleDelete = async (server: McpServerItem) => {
    if (!confirm(`确认删除个人 MCP "${server.name}"？`)) return;
    try {
      await deleteServer(server);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleToggleEnabled = async (server: McpServerItem, enabled: boolean) => {
    try {
      await toggleEnabled(server, enabled);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "更新失败");
    }
  };

  const content = (
    <div className="space-y-4">
      {errMsg && (
        <p className="text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700">
          {errMsg}
        </p>
      )}

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => void probeAll()}
          disabled={probingAll || servers.length === 0}
          className="text-xs px-3 py-1.5 border border-sky-200 rounded-lg text-sky-700 hover:bg-sky-50 disabled:opacity-50"
        >
          {probingAll ? "测试中…" : "测试全部"}
        </button>
      </div>

      <McpSection
        title="系统 MCP（只读）"
        badge="系统"
        badgeCls="bg-sky-50 text-sky-700"
        items={systemServers}
        statusMap={statusMap}
        probingKeys={probingKeys}
        expandedToolKeys={expandedToolKeys}
        canToggleEnabled={false}
        onProbe={(server) => void probeOne(server)}
        onToggleTools={toggleExpandedTools}
      />

      <McpSection
        title="我的 MCP"
        badge="我的"
        badgeCls="bg-emerald-50 text-emerald-700"
        items={userServers}
        statusMap={statusMap}
        probingKeys={probingKeys}
        expandedToolKeys={expandedToolKeys}
        onProbe={(server) => void probeOne(server)}
        onToggleTools={toggleExpandedTools}
        onToggleEnabled={(server, enabled) => void handleToggleEnabled(server, enabled)}
        onEdit={(server) => setEdit({
          name: server.name,
          isNew: false,
          config: {
            url: server.url,
            description: server.description ?? "",
            enabled: server.enabled !== false,
            api_key: "",
          },
        })}
        onDelete={(server) => void handleDelete(server)}
      />

      <button
        type="button"
        onClick={() => setEdit({ name: "", isNew: true, config: { ...EMPTY } })}
        className="w-full py-2.5 border-2 border-dashed border-emerald-300/80 text-emerald-700 text-sm rounded-xl hover:bg-emerald-50/50 transition-colors"
      >
        + 添加个人 MCP
      </button>

      {loading && <p className="text-xs text-ink-400 text-center">加载中…</p>}

      {edit && (
        <McpEditModal
          title={edit.isNew ? "添加个人 MCP" : `编辑个人 MCP · ${edit.name}`}
          name={edit.name}
          nameReadonly={!edit.isNew}
          onNameChange={(name) => setEdit({ ...edit, name })}
          config={edit.config}
          onChange={(patch) => setEdit({ ...edit, config: { ...edit.config, ...patch } })}
          onSave={() => void handleSave()}
          onCancel={() => setEdit(null)}
        />
      )}
    </div>
  );

  if (embedded) return content;

  return (
    <div className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white/95 backdrop-blur-xl rounded-2.5xl shadow-panel w-full max-w-lg max-h-[85vh] flex flex-col border border-ink-200/60">
        <div className="px-5 py-4 border-b border-ink-200/60 flex justify-between items-center">
          <div>
            <h2 className="font-semibold text-ink-900">MCP 配置</h2>
            <p className="text-xs text-ink-400">系统 MCP + 你的个人 MCP</p>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} className="text-sm text-ink-400 hover:text-ink-700 transition-colors">
              关闭
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{content}</div>
      </div>
    </div>
  );
}

function McpSection({
  title,
  badge,
  badgeCls,
  items,
  statusMap,
  probingKeys,
  expandedToolKeys,
  canToggleEnabled = true,
  onProbe,
  onToggleTools,
  onToggleEnabled,
  onEdit,
  onDelete,
}: {
  title: string;
  badge: string;
  badgeCls: string;
  items: McpServerItem[];
  statusMap: Record<string, import("../api/mcp").McpServerStatus>;
  probingKeys: Set<string>;
  expandedToolKeys: Set<string>;
  canToggleEnabled?: boolean;
  onProbe: (server: McpServerItem) => void;
  onToggleTools: (key: string) => void;
  onToggleEnabled?: (server: McpServerItem, enabled: boolean) => void;
  onEdit?: (server: McpServerItem) => void;
  onDelete?: (server: McpServerItem) => void;
}) {
  const scopeBadge = (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeCls}`}>{badge}</span>
  );

  return (
    <div>
      <h3 className="text-sm font-medium text-ink-700 mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-ink-400">暂无</p>
      ) : (
        <div className="space-y-2">
          {items.map((server) => {
            const key = serverStatusKey(server);
            return (
              <McpServerRow
                key={key}
                server={server}
                status={statusMap[key]}
                probing={probingKeys.has(key)}
                toolsExpanded={expandedToolKeys.has(key)}
                scopeBadge={scopeBadge}
                canToggleEnabled={canToggleEnabled}
                onToggleEnabled={onToggleEnabled ? (enabled) => onToggleEnabled(server, enabled) : undefined}
                onProbe={() => onProbe(server)}
                onToggleTools={() => onToggleTools(key)}
                onEdit={onEdit ? () => onEdit(server) : undefined}
                onDelete={onDelete ? () => onDelete(server) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
