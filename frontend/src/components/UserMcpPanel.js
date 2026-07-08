import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { mcpApi } from "../api/mcp";
const EMPTY = { url: "", description: "", enabled: true };
export default function UserMcpPanel({ userId, onClose }) {
    const [servers, setServers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editName, setEditName] = useState("");
    const [editCfg, setEditCfg] = useState({ ...EMPTY });
    const [showForm, setShowForm] = useState(false);
    const [msg, setMsg] = useState(null);
    const load = () => mcpApi.listForChat(userId)
        .then(setServers)
        .catch(() => setServers([]))
        .finally(() => setLoading(false));
    useEffect(() => { load(); }, [userId]);
    const userServers = servers.filter((s) => s.scope === "user");
    const systemServers = servers.filter((s) => s.scope === "system");
    const handleSave = async () => {
        if (!editName.trim() || !editCfg.url?.trim()) {
            setMsg({ type: "err", text: "名称和 URL 不能为空" });
            return;
        }
        setMsg(null);
        try {
            await mcpApi.addUserServer(userId, editName.trim(), editCfg);
            await load();
            setShowForm(false);
            setEditName("");
            setEditCfg({ ...EMPTY });
            setMsg({ type: "ok", text: "个人 MCP 已保存，新 session 生效" });
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "保存失败" });
        }
    };
    const handleDelete = async (name) => {
        if (!confirm(`确认删除个人 MCP "${name}"？`))
            return;
        await mcpApi.deleteUserServer(userId, name);
        await load();
        setMsg({ type: "ok", text: `已删除 ${name}` });
    };
    return (_jsx("div", { className: "fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "bg-white/95 backdrop-blur-xl rounded-2.5xl shadow-panel w-full max-w-lg max-h-[85vh] flex flex-col border border-ink-200/60", children: [_jsxs("div", { className: "px-5 py-4 border-b border-ink-200/60 flex justify-between items-center", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-semibold text-ink-900", children: "MCP \u914D\u7F6E" }), _jsx("p", { className: "text-xs text-ink-400", children: "\u7CFB\u7EDF MCP + \u4F60\u7684\u4E2A\u4EBA MCP\uFF08\u5747\u5B58 MongoDB\uFF09" })] }), _jsx("button", { onClick: onClose, className: "text-sm text-ink-400 hover:text-ink-700 transition-colors", children: "\u5173\u95ED" })] }), _jsxs("div", { className: "flex-1 overflow-y-auto px-5 py-4 space-y-4", children: [msg && (_jsx("p", { className: `text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`, children: msg.text })), _jsx(Section, { title: "\u7CFB\u7EDF MCP", items: systemServers, badge: "\u7CFB\u7EDF", badgeCls: "bg-sky-100 text-sky-700" }), _jsx(Section, { title: "\u6211\u7684 MCP", items: userServers, badge: "\u6211\u7684", badgeCls: "bg-emerald-100 text-emerald-700", onDelete: handleDelete }), showForm ? (_jsxs("div", { className: "border rounded-xl p-3 space-y-2", children: [_jsx("input", { value: editName, onChange: (e) => setEditName(e.target.value), placeholder: "server \u540D\u79F0", className: "w-full border rounded-lg px-2 py-1.5 text-sm" }), _jsx("input", { value: editCfg.url, onChange: (e) => setEditCfg({ ...editCfg, url: e.target.value }), placeholder: "http://...", className: "w-full border rounded-lg px-2 py-1.5 text-sm" }), _jsx("input", { value: editCfg.description ?? "", onChange: (e) => setEditCfg({ ...editCfg, description: e.target.value }), placeholder: "\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09", className: "w-full border rounded-lg px-2 py-1.5 text-sm" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: handleSave, className: "flex-1 py-1.5 bg-indigo-600 text-white text-sm rounded-lg", children: "\u4FDD\u5B58" }), _jsx("button", { onClick: () => setShowForm(false), className: "flex-1 py-1.5 border text-sm rounded-lg", children: "\u53D6\u6D88" })] })] })) : (_jsx("button", { onClick: () => setShowForm(true), className: "w-full py-2 border-2 border-dashed border-emerald-300 text-emerald-700 text-sm rounded-xl hover:bg-emerald-50", children: "+ \u6DFB\u52A0\u4E2A\u4EBA MCP" })), loading && _jsx("p", { className: "text-xs text-gray-400 text-center", children: "\u52A0\u8F7D\u4E2D\u2026" })] })] }) }));
}
function Section({ title, items, badge, badgeCls, onDelete, }) {
    return (_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-gray-700 mb-2", children: title }), items.length === 0 ? (_jsx("p", { className: "text-xs text-gray-400", children: "\u6682\u65E0" })) : (_jsx("div", { className: "space-y-2", children: items.map((s) => (_jsxs("div", { className: "flex items-center gap-2 border rounded-lg px-3 py-2", children: [_jsx("span", { className: `text-[10px] px-1.5 py-0.5 rounded ${badgeCls}`, children: badge }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("p", { className: "text-sm font-medium truncate", children: s.name }), _jsx("p", { className: "text-xs text-gray-500 truncate", children: s.description || s.url })] }), onDelete && (_jsx("button", { onClick: () => onDelete(s.name), className: "text-xs text-red-600 shrink-0", children: "\u5220\u9664" }))] }, `${s.scope}-${s.name}`))) }))] }));
}
