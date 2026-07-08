import { useEffect, useState } from "react";
import { mcpApi, McpServerConfig, McpServerItem } from "../api/mcp";

const EMPTY: McpServerConfig = { url: "", description: "", enabled: true, api_key: "" };

interface Props {
  userId: string;
  onClose?: () => void;
  embedded?: boolean;
}

export default function UserMcpPanel({ userId, onClose, embedded = false }: Props) {
  const [servers, setServers] = useState<McpServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState("");
  const [editCfg, setEditCfg] = useState<McpServerConfig>({ ...EMPTY });
  const [showForm, setShowForm] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const load = () =>
    mcpApi.listForChat(userId)
      .then(setServers)
      .catch(() => setServers([]))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, [userId]);

  const userServers = servers.filter((s) => s.scope === "user");
  const systemServers = servers.filter((s) => s.scope === "system");

  const handleSave = async () => {
    if (!editName.trim() || !editCfg.url?.trim()) {
      setErrMsg("名称和 URL 不能为空");
      return;
    }
    setErrMsg(null);
    try {
      await mcpApi.addUserServer(userId, editName.trim(), editCfg);
      await load();
      setShowForm(false);
      setEditName("");
      setEditCfg({ ...EMPTY });
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "保存失败");
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`确认删除个人 MCP "${name}"？`)) return;
    await mcpApi.deleteUserServer(userId, name);
    await load();
  };

  const content = (
    <div className="space-y-4">
      {errMsg && (
        <p className="text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700">
          {errMsg}
        </p>
      )}

      <Section title="系统 MCP（只读）" items={systemServers} badge="系统" badgeCls="bg-sky-50 text-sky-700" />
      <Section
        title="我的 MCP"
        items={userServers}
        badge="我的"
        badgeCls="bg-emerald-50 text-emerald-700"
        onDelete={handleDelete}
      />

      {showForm ? (
        <div className="border border-ink-200/60 rounded-xl p-4 space-y-2">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="server 名称"
            className="ui-field w-full"
          />
          <input
            value={editCfg.url}
            onChange={(e) => setEditCfg({ ...editCfg, url: e.target.value })}
            placeholder="http://..."
            className="ui-field w-full"
          />
          <input
            value={editCfg.description ?? ""}
            onChange={(e) => setEditCfg({ ...editCfg, description: e.target.value })}
            placeholder="描述（可选）"
            className="ui-field w-full"
          />
          <input
            type="password"
            value={editCfg.api_key ?? ""}
            onChange={(e) => setEditCfg({ ...editCfg, api_key: e.target.value })}
            placeholder="API Key（可选，付费 MCP 鉴权用）"
            className="ui-field w-full"
            autoComplete="off"
          />
          <div className="flex gap-2">
            <button type="button" onClick={handleSave} className="ui-btn-primary flex-1">保存</button>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2.5 text-sm border border-ink-200 rounded-xl">取消</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full py-2.5 border-2 border-dashed border-emerald-300/80 text-emerald-700 text-sm rounded-xl hover:bg-emerald-50/50 transition-colors"
        >
          + 添加个人 MCP
        </button>
      )}

      {loading && <p className="text-xs text-ink-400 text-center">加载中…</p>}
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
            <button type="button" onClick={onClose} className="text-sm text-ink-400 hover:text-ink-700 transition-colors">关闭</button>
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
  onDelete,
}: {
  title: string;
  items: McpServerItem[];
  badge: string;
  badgeCls: string;
  onDelete?: (name: string) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-ink-700 mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-ink-400">暂无</p>
      ) : (
        <div className="space-y-2">
          {items.map((s) => (
            <div key={`${s.scope}-${s.name}`} className="flex items-center gap-2 border border-ink-200/60 rounded-xl px-3 py-2.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeCls}`}>{badge}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-ink-800">{s.name}</p>
                <p className="text-xs text-ink-400 truncate">{s.description || s.url}</p>
                {s.has_api_key && <p className="text-[10px] text-amber-700 mt-0.5">已配置 API Key</p>}
              </div>
              {onDelete && (
                <button type="button" onClick={() => onDelete(s.name)} className="text-xs text-rose-500 shrink-0 hover:text-rose-700">删除</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
