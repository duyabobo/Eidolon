import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { McpEditModal, McpServerRow } from "./McpServerUi";
import { serverStatusKey } from "./mcpManagerUtils";
import { useMcpManager } from "./useMcpManager";
const EMPTY = { url: "", description: "", enabled: true, api_key: "" };
export default function UserMcpPanel({ userId, onClose, embedded = false }) {
    const { servers, loading, probingAll, probingKeys, statusMap, expandedToolKeys, errMsg, setErrMsg, load, probeAll, probeOne, toggleExpandedTools, saveServer, toggleEnabled, deleteServer, } = useMcpManager({ userId, includeDisabled: true });
    const [edit, setEdit] = useState(null);
    useEffect(() => {
        void load();
    }, [load]);
    const userServers = servers.filter((s) => s.scope === "user");
    const systemServers = servers.filter((s) => s.scope === "system");
    const handleSave = async () => {
        if (!edit)
            return;
        if (!edit.name.trim() || !edit.config.url?.trim()) {
            setErrMsg("名称和 URL 不能为空");
            return;
        }
        try {
            await saveServer("user", edit.name.trim(), edit.config);
            setEdit(null);
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "保存失败");
        }
    };
    const handleDelete = async (server) => {
        if (!confirm(`确认删除个人 MCP "${server.name}"？`))
            return;
        try {
            await deleteServer(server);
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "删除失败");
        }
    };
    const handleToggleEnabled = async (server, enabled) => {
        try {
            await toggleEnabled(server, enabled);
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "更新失败");
        }
    };
    const content = (_jsxs("div", { className: "space-y-4", children: [errMsg && (_jsx("p", { className: "text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700", children: errMsg })), _jsx("div", { className: "flex items-center justify-end", children: _jsx("button", { type: "button", onClick: () => void probeAll(), disabled: probingAll || servers.length === 0, className: "text-xs px-3 py-1.5 border border-sky-200 rounded-lg text-sky-700 hover:bg-sky-50 disabled:opacity-50", children: probingAll ? "测试中…" : "测试全部" }) }), _jsx(McpSection, { title: "\u7CFB\u7EDF MCP\uFF08\u53EA\u8BFB\uFF09", badge: "\u7CFB\u7EDF", badgeCls: "bg-sky-50 text-sky-700", items: systemServers, statusMap: statusMap, probingKeys: probingKeys, expandedToolKeys: expandedToolKeys, canToggleEnabled: false, onProbe: (server) => void probeOne(server), onToggleTools: toggleExpandedTools }), _jsx(McpSection, { title: "\u6211\u7684 MCP", badge: "\u6211\u7684", badgeCls: "bg-emerald-50 text-emerald-700", items: userServers, statusMap: statusMap, probingKeys: probingKeys, expandedToolKeys: expandedToolKeys, onProbe: (server) => void probeOne(server), onToggleTools: toggleExpandedTools, onToggleEnabled: (server, enabled) => void handleToggleEnabled(server, enabled), onEdit: (server) => setEdit({
                    name: server.name,
                    isNew: false,
                    config: {
                        url: server.url,
                        description: server.description ?? "",
                        enabled: server.enabled !== false,
                        api_key: "",
                    },
                }), onDelete: (server) => void handleDelete(server) }), _jsx("button", { type: "button", onClick: () => setEdit({ name: "", isNew: true, config: { ...EMPTY } }), className: "w-full py-2.5 border-2 border-dashed border-emerald-300/80 text-emerald-700 text-sm rounded-xl hover:bg-emerald-50/50 transition-colors", children: "\u6DFB\u52A0" }), loading && _jsx("p", { className: "text-xs text-ink-400 text-center", children: "\u52A0\u8F7D\u4E2D\u2026" }), edit && (_jsx(McpEditModal, { title: edit.isNew ? "添加个人 MCP" : `编辑个人 MCP · ${edit.name}`, name: edit.name, nameReadonly: !edit.isNew, onNameChange: (name) => setEdit({ ...edit, name }), config: edit.config, onChange: (patch) => setEdit({ ...edit, config: { ...edit.config, ...patch } }), onSave: () => void handleSave(), onCancel: () => setEdit(null) }))] }));
    if (embedded)
        return content;
    return (_jsx("div", { className: "fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "bg-white/95 backdrop-blur-xl rounded-2.5xl shadow-panel w-full max-w-lg max-h-[85vh] flex flex-col border border-ink-200/60", children: [_jsxs("div", { className: "px-5 py-4 border-b border-ink-200/60 flex justify-between items-center", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-semibold text-ink-900", children: "MCP \u914D\u7F6E" }), _jsx("p", { className: "text-xs text-ink-400", children: "\u7CFB\u7EDF MCP + \u4F60\u7684\u4E2A\u4EBA MCP" })] }), onClose && (_jsx("button", { type: "button", onClick: onClose, className: "text-sm text-ink-400 hover:text-ink-700 transition-colors", children: "\u5173\u95ED" }))] }), _jsx("div", { className: "flex-1 overflow-y-auto px-5 py-4", children: content })] }) }));
}
function McpSection({ title, badge, badgeCls, items, statusMap, probingKeys, expandedToolKeys, canToggleEnabled = true, onProbe, onToggleTools, onToggleEnabled, onEdit, onDelete, }) {
    const scopeBadge = (_jsx("span", { className: `text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeCls}`, children: badge }));
    return (_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-ink-700 mb-2", children: title }), items.length === 0 ? (_jsx("p", { className: "text-xs text-ink-400", children: "\u6682\u65E0" })) : (_jsx("div", { className: "space-y-2", children: items.map((server) => {
                    const key = serverStatusKey(server);
                    return (_jsx(McpServerRow, { server: server, status: statusMap[key], probing: probingKeys.has(key), toolsExpanded: expandedToolKeys.has(key), scopeBadge: scopeBadge, canToggleEnabled: canToggleEnabled, onToggleEnabled: onToggleEnabled ? (enabled) => onToggleEnabled(server, enabled) : undefined, onProbe: () => onProbe(server), onToggleTools: () => onToggleTools(key), onEdit: onEdit ? () => onEdit(server) : undefined, onDelete: onDelete ? () => onDelete(server) : undefined }, key));
                }) }))] }));
}
