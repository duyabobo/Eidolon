import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { mcpApi } from "../api/mcp";
import { McpEditModal, McpServerStatusBadge, mcpServerStatusKey } from "./McpServerUi";
const EMPTY = { url: "", description: "", enabled: true, api_key: "" };
export default function UserMcpPanel({ userId, onClose, embedded = false }) {
    const [servers, setServers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [probing, setProbing] = useState(false);
    const [statusMap, setStatusMap] = useState({});
    const [edit, setEdit] = useState(null);
    const [errMsg, setErrMsg] = useState(null);
    const refreshStatus = useCallback(async () => {
        setProbing(true);
        try {
            const res = await mcpApi.getServerStatus(userId);
            const next = {};
            for (const item of res.servers) {
                next[mcpServerStatusKey(item.scope, item.name)] = item;
            }
            setStatusMap(next);
        }
        catch {
            setStatusMap({});
        }
        finally {
            setProbing(false);
        }
    }, [userId]);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const list = await mcpApi.listForChat(userId);
            setServers(list);
        }
        catch {
            setServers([]);
        }
        finally {
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
        if (!edit)
            return;
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
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "保存失败");
        }
    };
    const handleDelete = async (name) => {
        if (!confirm(`确认删除个人 MCP "${name}"？`))
            return;
        setErrMsg(null);
        try {
            await mcpApi.deleteUserServer(userId, name);
            await load();
            await refreshStatus();
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "删除失败");
        }
    };
    const content = (_jsxs("div", { className: "space-y-4", children: [errMsg && (_jsx("p", { className: "text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700", children: errMsg })), _jsx(Section, { title: "\u7CFB\u7EDF MCP\uFF08\u53EA\u8BFB\uFF09", items: systemServers, badge: "\u7CFB\u7EDF", badgeCls: "bg-sky-50 text-sky-700", statusMap: statusMap, probing: probing }), _jsx(Section, { title: "\u6211\u7684 MCP", items: userServers, badge: "\u6211\u7684", badgeCls: "bg-emerald-50 text-emerald-700", statusMap: statusMap, probing: probing, onEdit: (server) => setEdit({
                    name: server.name,
                    isNew: false,
                    config: {
                        url: server.url,
                        description: server.description ?? "",
                        enabled: server.enabled !== false,
                        api_key: "",
                    },
                }), onDelete: handleDelete }), _jsx("button", { type: "button", onClick: () => setEdit({ name: "", isNew: true, config: { ...EMPTY } }), className: "w-full py-2.5 border-2 border-dashed border-emerald-300/80 text-emerald-700 text-sm rounded-xl hover:bg-emerald-50/50 transition-colors", children: "+ \u6DFB\u52A0\u4E2A\u4EBA MCP" }), loading && _jsx("p", { className: "text-xs text-ink-400 text-center", children: "\u52A0\u8F7D\u4E2D\u2026" }), edit && (_jsx(McpEditModal, { title: edit.isNew ? "添加个人 MCP" : `编辑个人 MCP · ${edit.name}`, name: edit.name, nameReadonly: !edit.isNew, onNameChange: (name) => setEdit({ ...edit, name }), config: edit.config, onChange: (patch) => setEdit({ ...edit, config: { ...edit.config, ...patch } }), onSave: () => void handleSave(), onCancel: () => setEdit(null) }))] }));
    if (embedded)
        return content;
    return (_jsx("div", { className: "fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "bg-white/95 backdrop-blur-xl rounded-2.5xl shadow-panel w-full max-w-lg max-h-[85vh] flex flex-col border border-ink-200/60", children: [_jsxs("div", { className: "px-5 py-4 border-b border-ink-200/60 flex justify-between items-center", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-semibold text-ink-900", children: "MCP \u914D\u7F6E" }), _jsx("p", { className: "text-xs text-ink-400", children: "\u7CFB\u7EDF MCP + \u4F60\u7684\u4E2A\u4EBA MCP" })] }), onClose && (_jsx("button", { type: "button", onClick: onClose, className: "text-sm text-ink-400 hover:text-ink-700 transition-colors", children: "\u5173\u95ED" }))] }), _jsx("div", { className: "flex-1 overflow-y-auto px-5 py-4", children: content })] }) }));
}
function Section({ title, items, badge, badgeCls, statusMap, probing, onEdit, onDelete, }) {
    return (_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-ink-700 mb-2", children: title }), items.length === 0 ? (_jsx("p", { className: "text-xs text-ink-400", children: "\u6682\u65E0" })) : (_jsx("div", { className: "space-y-2", children: items.map((server) => {
                    const statusKey = mcpServerStatusKey(server.scope, server.name);
                    return (_jsxs("div", { className: "flex items-center gap-2 border border-ink-200/60 rounded-xl px-3 py-2.5", children: [_jsx("span", { className: `text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeCls}`, children: badge }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("p", { className: "text-sm font-medium truncate text-ink-800", children: server.name }), _jsx(McpServerStatusBadge, { statusKey: statusKey, statusMap: statusMap, probing: probing })] }), _jsx("p", { className: "text-xs text-ink-400 truncate", children: server.description || server.url }), server.has_api_key && _jsx("p", { className: "text-[10px] text-amber-700 mt-0.5", children: "\u5DF2\u914D\u7F6E API Key" })] }), onEdit && (_jsx("button", { type: "button", onClick: () => onEdit(server), className: "text-xs text-ink-600 shrink-0 hover:text-ink-800", children: "\u7F16\u8F91" })), onDelete && (_jsx("button", { type: "button", onClick: () => onDelete(server.name), className: "text-xs text-rose-500 shrink-0 hover:text-rose-700", children: "\u5220\u9664" }))] }, statusKey));
                }) }))] }));
}
