import { useEffect, useState } from "react";
import { configApi, McpServerConfig } from "../api/config";
import { mcpApi, McpServerItem } from "../api/mcp";

const EMPTY_SERVER: McpServerConfig = { url: "", description: "", enabled: true };

interface SystemEditState {
  name: string;
  config: McpServerConfig;
}

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
  const [systemEdit, setSystemEdit] = useState<SystemEditState | null>(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [userName, setUserName] = useState("");
  const [userCfg, setUserCfg] = useState<McpServerConfig>({ ...EMPTY_SERVER });
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const load = async () => {
    try {
      const list = await mcpApi.listForChat(userId.trim() || undefined);
      setServers(list);
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [userId]);

  const handleDeleteSystem = async (name: string) => {
    if (!confirm(`确认删除系统 MCP "${name}"？`)) return;
    setMsg(null);
    try {
      await configApi.deleteServer(name);
      await load();
      setMsg({ type: "ok", text: `已删除 ${name}` });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "删除失败" });
    }
  };

  const handleSaveSystem = async () => {
    if (!systemEdit) return;
    if (!systemEdit.name.trim()) { setMsg({ type: "err", text: "名称不能为空" }); return; }
    setMsg(null);
    try {
      await configApi.addServer(systemEdit.name.trim(), systemEdit.config);
      await load();
      setSystemEdit(null);
      setMsg({ type: "ok", text: `${systemEdit.name} 已保存` });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "保存失败" });
    }
  };

  const handleSaveUser = async () => {
    if (!userId.trim()) { setMsg({ type: "err", text: "请先在「历史」页设置用户 ID" }); return; }
    if (!userName.trim() || !userCfg.url?.trim()) {
      setMsg({ type: "err", text: "名称和 URL 不能为空" });
      return;
    }
    setMsg(null);
    try {
      await mcpApi.addUserServer(userId.trim(), userName.trim(), userCfg);
      await load();
      setShowUserForm(false);
      setUserName("");
      setUserCfg({ ...EMPTY_SERVER });
      setMsg({ type: "ok", text: "个人 MCP 已保存，新 session 生效" });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "保存失败" });
    }
  };

  const handleDeleteUser = async (name: string) => {
    if (!userId.trim()) return;
    if (!confirm(`确认删除个人 MCP "${name}"？`)) return;
    await mcpApi.deleteUserServer(userId.trim(), name);
    await load();
    setMsg({ type: "ok", text: `已删除 ${name}` });
  };

  if (loading) return <div className="text-sm text-ink-400">加载中…</div>;

  return (
    <div className="space-y-4">
      {msg && (
        <p className={`text-sm px-3 py-2 rounded-lg ${
          msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
        }`}>
          {msg.text}
        </p>
      )}

      <div className="space-y-2">
        {servers.length === 0 && (
          <p className="text-sm text-ink-400 text-center py-8 border border-dashed border-ink-200 rounded-xl">
            暂无 MCP Server
          </p>
        )}
        {servers.map((s) => (
          <div
            key={`${s.scope}-${s.name}`}
            className="flex items-center gap-3 border border-ink-200/60 rounded-xl px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <ScopeBadge scope={s.scope} />
                <span className="text-sm font-medium text-ink-800">{s.name}</span>
                {s.enabled === false && (
                  <span className="text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded">已禁用</span>
                )}
              </div>
              <p className="text-xs text-ink-400 truncate mt-0.5">{s.url}</p>
              {s.description && <p className="text-xs text-ink-400 mt-0.5">{s.description}</p>}
            </div>
            <div className="flex gap-2 shrink-0">
              {s.scope === "system" && (
                <>
                  <button
                    type="button"
                    onClick={() => setSystemEdit({ name: s.name, config: { url: s.url, description: s.description, enabled: s.enabled } })}
                    className="text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSystem(s.name)}
                    className="text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50"
                  >
                    删除
                  </button>
                </>
              )}
              {s.scope === "user" && (
                <button
                  type="button"
                  onClick={() => handleDeleteUser(s.name)}
                  className="text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50"
                >
                  删除
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showUserForm ? (
        <div className="border border-ink-200/60 rounded-xl p-4 space-y-2">
          <p className="text-sm font-medium text-ink-700">添加个人 MCP</p>
          <input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="server 名称" className="ui-field w-full" />
          <input value={userCfg.url} onChange={(e) => setUserCfg({ ...userCfg, url: e.target.value })} placeholder="http://..." className="ui-field w-full" />
          <input
            value={userCfg.description ?? ""}
            onChange={(e) => setUserCfg({ ...userCfg, description: e.target.value })}
            placeholder="描述（可选）"
            className="ui-field w-full"
          />
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={handleSaveUser} className="ui-btn-primary flex-1">保存</button>
            <button
              type="button"
              onClick={() => { setShowUserForm(false); setUserName(""); setUserCfg({ ...EMPTY_SERVER }); }}
              className="flex-1 py-2.5 text-sm border border-ink-200 rounded-xl text-ink-600"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (!userId.trim()) { setMsg({ type: "err", text: "请先在「历史」页设置用户 ID" }); return; }
            setShowUserForm(true);
          }}
          className="w-full py-2.5 border-2 border-dashed border-emerald-300/80 text-emerald-700 text-sm rounded-xl hover:bg-emerald-50/50 transition-colors"
        >
          + 添加个人 MCP
        </button>
      )}

      {systemEdit && (
        <SystemEditModal
          edit={systemEdit}
          onChange={setSystemEdit}
          onSave={handleSaveSystem}
          onCancel={() => setSystemEdit(null)}
        />
      )}
    </div>
  );
}

function SystemEditModal({
  edit, onChange, onSave, onCancel,
}: {
  edit: SystemEditState;
  onChange: (e: SystemEditState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { name, config: cfg } = edit;
  const set = (patch: Partial<McpServerConfig>) =>
    onChange({ ...edit, config: { ...cfg, ...patch } });

  return (
    <div className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60">
        <div className="px-6 py-4 border-b border-ink-200/60">
          <h2 className="font-semibold text-ink-900">编辑系统 MCP · {name}</h2>
        </div>
        <div className="px-6 py-4 space-y-3">
          <input value={cfg.url} onChange={(e) => set({ url: e.target.value })} placeholder="URL" className="ui-field w-full" />
          <input value={cfg.description ?? ""} onChange={(e) => set({ description: e.target.value })} placeholder="描述" className="ui-field w-full" />
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={cfg.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} />
            启用
          </label>
        </div>
        <div className="px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-ink-600 border border-ink-200 rounded-xl">取消</button>
          <button type="button" onClick={onSave} className="ui-btn-primary">保存</button>
        </div>
      </div>
    </div>
  );
}
