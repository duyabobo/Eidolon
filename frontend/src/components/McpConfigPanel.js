import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { configApi } from "../api/config";
import { mcpApi } from "../api/mcp";
const EMPTY_SERVER = { url: "", description: "", enabled: true };
function ScopeBadge({ scope }) {
    return (_jsx("span", { className: `text-[10px] px-1.5 py-0.5 rounded-full font-medium ${scope === "user" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`, children: scope === "user" ? "我的" : "系统" }));
}
export default function McpConfigPanel({ userId }) {
    const [servers, setServers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [systemEdit, setSystemEdit] = useState(null);
    const [showUserForm, setShowUserForm] = useState(false);
    const [userName, setUserName] = useState("");
    const [userCfg, setUserCfg] = useState({ ...EMPTY_SERVER });
    const [msg, setMsg] = useState(null);
    const load = async () => {
        try {
            const list = await mcpApi.listForChat(userId.trim() || undefined);
            setServers(list);
        }
        catch {
            setServers([]);
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, [userId]);
    const handleDeleteSystem = async (name) => {
        if (!confirm(`确认删除系统 MCP "${name}"？`))
            return;
        setMsg(null);
        try {
            await configApi.deleteServer(name);
            await load();
            setMsg({ type: "ok", text: `已删除 ${name}` });
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "删除失败" });
        }
    };
    const handleSaveSystem = async () => {
        if (!systemEdit)
            return;
        if (!systemEdit.name.trim()) {
            setMsg({ type: "err", text: "名称不能为空" });
            return;
        }
        setMsg(null);
        try {
            await configApi.addServer(systemEdit.name.trim(), systemEdit.config);
            await load();
            setSystemEdit(null);
            setMsg({ type: "ok", text: `${systemEdit.name} 已保存` });
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "保存失败" });
        }
    };
    const handleSaveUser = async () => {
        if (!userId.trim()) {
            setMsg({ type: "err", text: "请先在「历史」页设置用户 ID" });
            return;
        }
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
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "保存失败" });
        }
    };
    const handleDeleteUser = async (name) => {
        if (!userId.trim())
            return;
        if (!confirm(`确认删除个人 MCP "${name}"？`))
            return;
        await mcpApi.deleteUserServer(userId.trim(), name);
        await load();
        setMsg({ type: "ok", text: `已删除 ${name}` });
    };
    if (loading)
        return _jsx("div", { className: "text-sm text-ink-400", children: "\u52A0\u8F7D\u4E2D\u2026" });
    return (_jsxs("div", { className: "space-y-4", children: [msg && (_jsx("p", { className: `text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`, children: msg.text })), _jsxs("div", { className: "space-y-2", children: [servers.length === 0 && (_jsx("p", { className: "text-sm text-ink-400 text-center py-8 border border-dashed border-ink-200 rounded-xl", children: "\u6682\u65E0 MCP Server" })), servers.map((s) => (_jsxs("div", { className: "flex items-center gap-3 border border-ink-200/60 rounded-xl px-4 py-3", children: [_jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx(ScopeBadge, { scope: s.scope }), _jsx("span", { className: "text-sm font-medium text-ink-800", children: s.name }), s.enabled === false && (_jsx("span", { className: "text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded", children: "\u5DF2\u7981\u7528" }))] }), _jsx("p", { className: "text-xs text-ink-400 truncate mt-0.5", children: s.url }), s.description && _jsx("p", { className: "text-xs text-ink-400 mt-0.5", children: s.description })] }), _jsxs("div", { className: "flex gap-2 shrink-0", children: [s.scope === "system" && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => setSystemEdit({ name: s.name, config: { url: s.url, description: s.description, enabled: s.enabled } }), className: "text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50", children: "\u7F16\u8F91" }), _jsx("button", { type: "button", onClick: () => handleDeleteSystem(s.name), className: "text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50", children: "\u5220\u9664" })] })), s.scope === "user" && (_jsx("button", { type: "button", onClick: () => handleDeleteUser(s.name), className: "text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50", children: "\u5220\u9664" }))] })] }, `${s.scope}-${s.name}`)))] }), showUserForm ? (_jsxs("div", { className: "border border-ink-200/60 rounded-xl p-4 space-y-2", children: [_jsx("p", { className: "text-sm font-medium text-ink-700", children: "\u6DFB\u52A0\u4E2A\u4EBA MCP" }), _jsx("input", { value: userName, onChange: (e) => setUserName(e.target.value), placeholder: "server \u540D\u79F0", className: "ui-field w-full" }), _jsx("input", { value: userCfg.url, onChange: (e) => setUserCfg({ ...userCfg, url: e.target.value }), placeholder: "http://...", className: "ui-field w-full" }), _jsx("input", { value: userCfg.description ?? "", onChange: (e) => setUserCfg({ ...userCfg, description: e.target.value }), placeholder: "\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09", className: "ui-field w-full" }), _jsxs("div", { className: "flex gap-2 pt-1", children: [_jsx("button", { type: "button", onClick: handleSaveUser, className: "ui-btn-primary flex-1", children: "\u4FDD\u5B58" }), _jsx("button", { type: "button", onClick: () => { setShowUserForm(false); setUserName(""); setUserCfg({ ...EMPTY_SERVER }); }, className: "flex-1 py-2.5 text-sm border border-ink-200 rounded-xl text-ink-600", children: "\u53D6\u6D88" })] })] })) : (_jsx("button", { type: "button", onClick: () => {
                    if (!userId.trim()) {
                        setMsg({ type: "err", text: "请先在「历史」页设置用户 ID" });
                        return;
                    }
                    setShowUserForm(true);
                }, className: "w-full py-2.5 border-2 border-dashed border-emerald-300/80 text-emerald-700 text-sm rounded-xl hover:bg-emerald-50/50 transition-colors", children: "+ \u6DFB\u52A0\u4E2A\u4EBA MCP" })), systemEdit && (_jsx(SystemEditModal, { edit: systemEdit, onChange: setSystemEdit, onSave: handleSaveSystem, onCancel: () => setSystemEdit(null) }))] }));
}
function SystemEditModal({ edit, onChange, onSave, onCancel, }) {
    const { name, config: cfg } = edit;
    const set = (patch) => onChange({ ...edit, config: { ...cfg, ...patch } });
    return (_jsx("div", { className: "fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60", children: [_jsx("div", { className: "px-6 py-4 border-b border-ink-200/60", children: _jsxs("h2", { className: "font-semibold text-ink-900", children: ["\u7F16\u8F91\u7CFB\u7EDF MCP \u00B7 ", name] }) }), _jsxs("div", { className: "px-6 py-4 space-y-3", children: [_jsx("input", { value: cfg.url, onChange: (e) => set({ url: e.target.value }), placeholder: "URL", className: "ui-field w-full" }), _jsx("input", { value: cfg.description ?? "", onChange: (e) => set({ description: e.target.value }), placeholder: "\u63CF\u8FF0", className: "ui-field w-full" }), _jsxs("label", { className: "flex items-center gap-2 text-sm text-ink-700", children: [_jsx("input", { type: "checkbox", checked: cfg.enabled !== false, onChange: (e) => set({ enabled: e.target.checked }) }), "\u542F\u7528"] })] }), _jsxs("div", { className: "px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2", children: [_jsx("button", { type: "button", onClick: onCancel, className: "px-4 py-2 text-sm text-ink-600 border border-ink-200 rounded-xl", children: "\u53D6\u6D88" }), _jsx("button", { type: "button", onClick: onSave, className: "ui-btn-primary", children: "\u4FDD\u5B58" })] })] }) }));
}
