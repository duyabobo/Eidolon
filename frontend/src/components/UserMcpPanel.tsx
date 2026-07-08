import { useCallback, useEffect, useState } from "react";
import { mcpApi, McpServerConfig, McpServerItem, McpServerStatus } from "../api/mcp";
import { McpEditModal, McpServerStatusBadge, mcpServerStatusKey } from "./McpServerUi";

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
  const [servers, setServers] = useState<McpServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [statusMap, setStatusMap] = useState<Record<string, McpServerStatus>>({});
  const [edit, setEdit] = useState<EditState | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setProbing(true);
    try {
      const res = await mcpApi.getServerStatus(userId);
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
      const list = await mcpApi.listForChat(userId);
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

  const userServers = servers.filter((s) => s.scope === "user");
  const systemServers = servers.filter((s) => s.scope === "system");

  const handleSave = async () => {
    if (!edit) return;
    if (!edit.name.trim() || !edit.config.url?.trim()) {
      setErrMsg("名称和 URL 不能为空");
      return;
    }
    setErrMsg(null);
    try {
      await mcpApi.addUserServer(userId, edit.name.trim(), edit.config);
      setEdit(null);
      await load();
      await refreshStatus();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "保存失败");
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`确认删除个人 MCP "${name}"？`)) return;
    setErrMsg(null);
    try {
      await mcpApi.deleteUserServer(userId, name);
      await load();
      await refreshStatus();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "删除失败");
    }
  };

  const content = (
    <div className="space-y-4">
      {errMsg && (
        <p className="text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700">
          {errMsg}
        </p>
      )}

      <Section
        title="系统 MCP（只读）"
        items={systemServers}
        badge="系统"
        badgeCls="bg-sky-50 text-sky-700"
        statusMap={statusMap}
        probing={probing}
      />
      <Section
        title="我的 MCP"
        items={userServers}
        badge="我的"
        badgeCls="bg-emerald-50 text-emerald-700"
        statusMap={statusMap}
        probing={probing}
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
        onDelete={handleDelete}
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

function Section({
  title,
  items,
  badge,
  badgeCls,
  statusMap,
  probing,
  onEdit,
  onDelete,
}: {
  title: string;
  items: McpServerItem[];
  badge: string;
  badgeCls: string;
  statusMap: Record<string, McpServerStatus>;
  probing: boolean;
  onEdit?: (server: McpServerItem) => void;
  onDelete?: (name: string) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-ink-700 mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-ink-400">暂无</p>
      ) : (
        <div className="space-y-2">
          {items.map((server) => {
            const statusKey = mcpServerStatusKey(server.scope, server.name);
            return (
              <div key={statusKey} className="flex items-center gap-2 border border-ink-200/60 rounded-xl px-3 py-2.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeCls}`}>{badge}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate text-ink-800">{server.name}</p>
                    <McpServerStatusBadge statusKey={statusKey} statusMap={statusMap} probing={probing} />
                  </div>
                  <p className="text-xs text-ink-400 truncate">{server.description || server.url}</p>
                  {server.has_api_key && <p className="text-[10px] text-amber-700 mt-0.5">已配置 API Key</p>}
                </div>
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(server)}
                    className="text-xs text-ink-600 shrink-0 hover:text-ink-800"
                  >
                    编辑
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(server.name)}
                    className="text-xs text-rose-500 shrink-0 hover:text-rose-700"
                  >
                    删除
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
