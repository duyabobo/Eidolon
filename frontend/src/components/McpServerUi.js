import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function mcpServerStatusKey(scope, name) {
    return `${scope}:${name}`;
}
export function McpServerStatusBadge({ status, probing, serverEnabled }) {
    if (!serverEnabled) {
        return (_jsx("span", { className: "text-[10px] px-1.5 py-0.5 rounded-full bg-ink-100 text-ink-500", children: "\u5DF2\u7981\u7528" }));
    }
    if (probing && !status) {
        return _jsx("span", { className: "text-[10px] text-ink-400", children: "\u68C0\u6D4B\u4E2D\u2026" });
    }
    if (!status) {
        return _jsx("span", { className: "text-[10px] text-ink-400", children: "\u672A\u6D4B\u8BD5" });
    }
    if (status.skipped) {
        return (_jsx("span", { className: "text-[10px] px-1.5 py-0.5 rounded-full bg-ink-100 text-ink-500", children: "\u5DF2\u8DF3\u8FC7" }));
    }
    if (status.available) {
        const latency = status.latency_ms ? ` · ${status.latency_ms}ms` : "";
        return (_jsxs("span", { className: "text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700", children: ["\u53EF\u7528 \u00B7 ", status.tool_count, " tools", latency] }));
    }
    return (_jsx("span", { className: "text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 max-w-[220px] truncate", title: status.error || "连接失败", children: "\u4E0D\u53EF\u7528" }));
}
export function McpToolList({ tools, expanded, onToggle }) {
    if (tools.length === 0)
        return null;
    return (_jsxs("div", { className: "mt-2", children: [_jsx("button", { type: "button", onClick: onToggle, className: "text-[11px] text-sky-700 hover:text-sky-900", children: expanded ? "收起 tools" : `展开 tools (${tools.length})` }), expanded && (_jsx("ul", { className: "mt-1.5 flex flex-wrap gap-1", children: tools.map((tool) => (_jsx("li", { className: "text-[10px] px-1.5 py-0.5 rounded bg-ink-50 text-ink-600 font-mono", children: tool }, tool))) }))] }));
}
export function McpServerRow({ server, status, probing, toolsExpanded, scopeBadge, canToggleEnabled = true, onToggleEnabled, onProbe, onToggleTools, onEdit, onDelete, }) {
    const enabled = server.enabled !== false;
    return (_jsx("div", { className: "border border-ink-200/60 rounded-xl px-4 py-3", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [scopeBadge, _jsx("span", { className: "text-sm font-medium text-ink-800", children: server.name }), server.has_api_key && (_jsx("span", { className: "text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded", children: "\u5DF2\u914D\u7F6E API Key" })), _jsx(McpServerStatusBadge, { status: status, probing: probing, serverEnabled: enabled })] }), _jsx("p", { className: "text-xs text-ink-400 truncate mt-0.5", children: server.url }), server.description && (_jsx("p", { className: "text-xs text-ink-400 mt-0.5", children: server.description })), status?.tools && status.tools.length > 0 && (_jsx(McpToolList, { tools: status.tools, expanded: toolsExpanded, onToggle: onToggleTools }))] }), _jsxs("div", { className: "flex flex-col items-end gap-2 shrink-0", children: [canToggleEnabled && onToggleEnabled && (_jsxs("label", { className: "flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: enabled, onChange: (e) => onToggleEnabled(e.target.checked) }), "\u542F\u7528"] })), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", onClick: onProbe, disabled: probing, className: "text-xs px-3 py-1 border border-sky-200 rounded-lg text-sky-700 hover:bg-sky-50 disabled:opacity-50", children: probing ? "测试中…" : "测试" }), onEdit && (_jsx("button", { type: "button", onClick: onEdit, className: "text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50", children: "\u7F16\u8F91" })), onDelete && (_jsx("button", { type: "button", onClick: onDelete, className: "text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50", children: "\u5220\u9664" }))] })] })] }) }));
}
export function McpEditModal({ title, config, nameReadonly = true, name = "", onNameChange, onChange, onSave, onCancel, }) {
    return (_jsx("div", { className: "fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60", children: [_jsx("div", { className: "px-6 py-4 border-b border-ink-200/60", children: _jsx("h2", { className: "font-semibold text-ink-900", children: title }) }), _jsxs("div", { className: "px-6 py-4 space-y-3", children: [!nameReadonly ? (_jsx("input", { value: name, onChange: (e) => onNameChange?.(e.target.value), placeholder: "server \u540D\u79F0", className: "ui-field w-full" })) : name ? (_jsx("input", { value: name, readOnly: true, className: "ui-field w-full bg-ink-50 text-ink-500" })) : null, _jsx("input", { value: config.url, onChange: (e) => onChange({ url: e.target.value }), placeholder: "URL", className: "ui-field w-full" }), _jsx("input", { value: config.description ?? "", onChange: (e) => onChange({ description: e.target.value }), placeholder: "\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09", className: "ui-field w-full" }), _jsx("input", { type: "password", value: config.api_key ?? "", onChange: (e) => onChange({ api_key: e.target.value }), placeholder: "API Key\uFF08\u53EF\u9009\uFF0C\u7559\u7A7A\u5219\u4E0D\u4FEE\u6539\u5DF2\u4FDD\u5B58\u7684 Key\uFF09", className: "ui-field w-full", autoComplete: "off" }), _jsxs("label", { className: "flex items-center gap-2 text-sm text-ink-700", children: [_jsx("input", { type: "checkbox", checked: config.enabled !== false, onChange: (e) => onChange({ enabled: e.target.checked }) }), "\u542F\u7528"] })] }), _jsxs("div", { className: "px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2", children: [_jsx("button", { type: "button", onClick: onCancel, className: "px-4 py-2 text-sm text-ink-600 border border-ink-200 rounded-xl", children: "\u53D6\u6D88" }), _jsx("button", { type: "button", onClick: onSave, className: "ui-btn-primary", children: "\u4FDD\u5B58" })] })] }) }));
}
