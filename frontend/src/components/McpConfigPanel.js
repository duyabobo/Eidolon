import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { configApi } from "../api/config";
import { ConfigPrimaryBtn, ConfigToolbarBtn } from "./config/ConfigActionBtn";
import { ScopeBadge } from "./config/ConfigListItem";
import { ConfigEmptyState, ConfigListToolbar, ConfigPanelLayout, } from "./config/ConfigPanelLayout";
import { McpEditModal, McpServerRow } from "./McpServerUi";
import { serverStatusKey } from "./mcpManagerUtils";
import { useMcpManager } from "./useMcpManager";
const EMPTY_SERVER = { url: "", description: "", enabled: true, api_key: "" };
export default function McpConfigPanel({ userId }) {
    const { servers, loading, probingAll, probingKeys, statusMap, expandedToolKeys, errMsg, setErrMsg, load, probeAll, probeOne, toggleExpandedTools, saveServer, toggleEnabled, deleteServer, } = useMcpManager({ userId, includeDisabled: true });
    const [edit, setEdit] = useState(null);
    useEffect(() => {
        void load();
    }, [load]);
    const handleDelete = async (server) => {
        const label = server.scope === "system" ? "系统" : "个人";
        if (!confirm(`确认删除${label} MCP "${server.name}"？`))
            return;
        try {
            await deleteServer(server);
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "删除失败");
        }
    };
    const openSystemEdit = async (server) => {
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
        }
        catch {
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
    const openUserEdit = (server) => {
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
        if (!edit)
            return;
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
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "保存失败");
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
    return (_jsxs(ConfigPanelLayout, { loading: loading, errMsg: errMsg, toolbar: (_jsx(ConfigListToolbar, { left: _jsx("p", { className: "text-xs text-ink-500", children: "\u542B\u5DF2\u7981\u7528 Server\uFF1B\u53EF\u7528\u6027\u9700\u624B\u52A8\u6D4B\u8BD5\u540E\u5237\u65B0 tool \u5217\u8868" }), right: (_jsxs(_Fragment, { children: [_jsx(ConfigToolbarBtn, { onClick: () => void probeAll(), disabled: probingAll || servers.length === 0, children: probingAll ? "测试中…" : "测试全部" }), _jsx(ConfigPrimaryBtn, { onClick: openUserCreate, children: "+ \u6DFB\u52A0 MCP" })] })) })), children: [servers.length === 0 ? (_jsx(ConfigEmptyState, { message: "\u6682\u65E0 MCP Server" })) : (_jsx("div", { className: "space-y-2", children: servers.map((server) => {
                    const key = serverStatusKey(server);
                    return (_jsx(McpServerRow, { server: server, status: statusMap[key], probing: probingKeys.has(key), toolsExpanded: expandedToolKeys.has(key), scopeBadge: _jsx(ScopeBadge, { scope: server.scope }), onToggleEnabled: (enabled) => void handleToggleEnabled(server, enabled), onProbe: () => void probeOne(server), onToggleTools: () => toggleExpandedTools(key), onEdit: () => (server.scope === "system" ? void openSystemEdit(server) : openUserEdit(server)), onDelete: () => void handleDelete(server) }, key));
                }) })), edit && (_jsx(McpEditModal, { title: edit.isNew
                    ? "添加个人 MCP"
                    : edit.scope === "system"
                        ? `编辑系统 MCP · ${edit.name}`
                        : `编辑个人 MCP · ${edit.name}`, name: edit.name, nameReadonly: !edit.isNew, onNameChange: (name) => setEdit({ ...edit, name }), config: edit.config, onChange: (patch) => setEdit({ ...edit, config: { ...edit.config, ...patch } }), onSave: () => void handleSaveEdit(), onCancel: () => setEdit(null) }))] }));
}
