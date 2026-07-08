import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { configApi } from "../api/config";
const EMPTY_SERVER = {
    url: "",
    description: "",
    enabled: true,
};
export default function McpConfigPanel() {
    const [mcpConfig, setMcpConfig] = useState({ servers: {} });
    const [loading, setLoading] = useState(true);
    const [edit, setEdit] = useState(null);
    const [msg, setMsg] = useState(null);
    const load = () => configApi.getMcp()
        .then(setMcpConfig)
        .catch(() => { })
        .finally(() => setLoading(false));
    useEffect(() => { load(); }, []);
    const openNew = () => setEdit({ name: "", config: { ...EMPTY_SERVER } });
    const openEdit = (name) => setEdit({ name, config: { ...mcpConfig.servers[name] } });
    const handleDelete = async (name) => {
        if (!confirm(`确认删除 MCP server "${name}"？`))
            return;
        setMsg(null);
        try {
            const updated = await configApi.deleteServer(name);
            setMcpConfig(updated);
            setMsg({ type: "ok", text: `已删除 ${name}` });
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "删除失败" });
        }
    };
    const handleSaveServer = async () => {
        if (!edit)
            return;
        if (!edit.name.trim()) {
            setMsg({ type: "err", text: "Server 名称不能为空" });
            return;
        }
        setMsg(null);
        try {
            const updated = await configApi.addServer(edit.name.trim(), edit.config);
            setMcpConfig(updated);
            setEdit(null);
            setMsg({ type: "ok", text: `${edit.name} 已保存，新 session 启动时生效` });
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "保存失败" });
        }
    };
    if (loading)
        return _jsx("div", { className: "text-sm text-gray-400", children: "\u52A0\u8F7D\u4E2D\u2026" });
    const servers = Object.entries(mcpConfig.servers);
    return (_jsxs("div", { className: "space-y-4", children: [_jsx("p", { className: "text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2", children: "\u7CFB\u7EDF MCP \u914D\u7F6E\u4FDD\u5B58\u5728 MongoDB\uFF08mcp_servers \u96C6\u5408\uFF0Cuser_id \u4E3A\u7A7A\uFF09\u3002\u4FDD\u5B58\u540E mcp-proxy \u6700\u591A 60s \u5185\u81EA\u52A8\u751F\u6548\u3002" }), msg && (_jsx("p", { className: `text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`, children: msg.text })), _jsxs("div", { className: "space-y-2", children: [servers.length === 0 && (_jsx("p", { className: "text-sm text-gray-400 text-center py-8 border border-dashed border-gray-300 rounded-xl", children: "\u6682\u65E0 MCP Server\uFF0C\u70B9\u51FB\u300C\u6DFB\u52A0\u300D\u65B0\u589E" })), servers.map(([name, cfg]) => (_jsxs("div", { className: "flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm", children: [_jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xs bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded", children: "\u7CFB\u7EDF" }), _jsx("span", { className: "text-sm font-medium text-gray-800", children: name }), cfg.enabled === false && (_jsx("span", { className: "text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded", children: "\u5DF2\u7981\u7528" }))] }), _jsx("p", { className: "text-xs text-gray-500 truncate mt-0.5", children: cfg.url ?? "" }), cfg.description && (_jsx("p", { className: "text-xs text-gray-400 mt-0.5", children: cfg.description }))] }), _jsxs("div", { className: "flex gap-2 shrink-0", children: [_jsx("button", { onClick: () => openEdit(name), className: "text-xs px-3 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50", children: "\u7F16\u8F91" }), _jsx("button", { onClick: () => handleDelete(name), className: "text-xs px-3 py-1 border border-red-300 rounded-lg text-red-600 hover:bg-red-50", children: "\u5220\u9664" })] })] }, name)))] }), _jsx("button", { onClick: openNew, className: "px-4 py-2 border-2 border-dashed border-indigo-300 text-indigo-600 text-sm rounded-xl hover:bg-indigo-50 transition-colors w-full", children: "+ \u6DFB\u52A0 MCP Server" }), edit && (_jsx(ServerEditModal, { edit: edit, onChange: setEdit, onSave: handleSaveServer, onCancel: () => setEdit(null) }))] }));
}
function ServerEditModal({ edit, onChange, onSave, onCancel, }) {
    const { name, config: cfg } = edit;
    const set = (patch) => onChange({ ...edit, config: { ...cfg, ...patch } });
    return (_jsx("div", { className: "fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto", children: [_jsx("div", { className: "px-6 py-4 border-b", children: _jsx("h2", { className: "font-semibold text-gray-800", children: name ? `编辑 ${name}` : "添加 MCP Server" }) }), _jsxs("div", { className: "px-6 py-4 space-y-4", children: [_jsx("p", { className: "text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2", children: "\u4EC5\u652F\u6301 HTTP/SSE transport\uFF08\u8FDC\u7A0B MCP Server\uFF09\u3002stdio \u672C\u5730\u8FDB\u7A0B\u7C7B\u578B\u56E0\u5B89\u5168\u539F\u56E0\u4E0D\u88AB\u5141\u8BB8\u3002" }), _jsx(ModalField, { label: "Server \u540D\u79F0", children: _jsx("input", { value: name, onChange: (e) => onChange({ ...edit, name: e.target.value }), placeholder: "my-mcp-server", className: inputCls }) }), _jsx(ModalField, { label: "URL\uFF08HTTP/SSE \u8FDC\u7A0B\u7AEF\u70B9\uFF09", children: _jsx("input", { value: cfg.url, onChange: (e) => set({ url: e.target.value }), placeholder: "http://mcp-server:8080/sse", className: inputCls }) }), _jsx(ModalField, { label: "\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09", children: _jsx("input", { value: cfg.description ?? "", onChange: (e) => set({ description: e.target.value }), placeholder: "\u5DE5\u5177\u7528\u9014\u8BF4\u660E", className: inputCls }) }), _jsxs("label", { className: "flex items-center gap-2 text-sm text-gray-700", children: [_jsx("input", { type: "checkbox", checked: cfg.enabled !== false, onChange: (e) => set({ enabled: e.target.checked }), className: "rounded" }), "\u542F\u7528\u6B64 Server"] })] }), _jsxs("div", { className: "px-6 py-4 border-t flex justify-end gap-3", children: [_jsx("button", { onClick: onCancel, className: "px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50", children: "\u53D6\u6D88" }), _jsx("button", { onClick: onSave, className: "px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700", children: "\u4FDD\u5B58" })] })] }) }));
}
function ModalField({ label, children }) {
    return (_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: label }), children] }));
}
const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";
