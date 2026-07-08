import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function mcpServerStatusKey(scope, name) {
    return `${scope}:${name}`;
}
export function McpServerStatusBadge({ statusKey, statusMap, probing }) {
    const status = statusMap[statusKey];
    if (probing && !status) {
        return _jsx("span", { className: "text-[10px] text-ink-400", children: "\u68C0\u6D4B\u4E2D\u2026" });
    }
    if (!status) {
        return null;
    }
    if (status.available) {
        return (_jsxs("span", { className: "text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700", children: ["\u53EF\u7528 \u00B7 ", status.tool_count, " tools"] }));
    }
    return (_jsx("span", { className: "text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 max-w-[220px] truncate", title: status.error || "连接失败", children: "\u4E0D\u53EF\u7528" }));
}
export function McpEditModal({ title, config, nameReadonly = true, name = "", onNameChange, onChange, onSave, onCancel, }) {
    return (_jsx("div", { className: "fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60", children: [_jsx("div", { className: "px-6 py-4 border-b border-ink-200/60", children: _jsx("h2", { className: "font-semibold text-ink-900", children: title }) }), _jsxs("div", { className: "px-6 py-4 space-y-3", children: [!nameReadonly ? (_jsx("input", { value: name, onChange: (e) => onNameChange?.(e.target.value), placeholder: "server \u540D\u79F0", className: "ui-field w-full" })) : name ? (_jsx("input", { value: name, readOnly: true, className: "ui-field w-full bg-ink-50 text-ink-500" })) : null, _jsx("input", { value: config.url, onChange: (e) => onChange({ url: e.target.value }), placeholder: "URL", className: "ui-field w-full" }), _jsx("input", { value: config.description ?? "", onChange: (e) => onChange({ description: e.target.value }), placeholder: "\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09", className: "ui-field w-full" }), _jsx("input", { type: "password", value: config.api_key ?? "", onChange: (e) => onChange({ api_key: e.target.value }), placeholder: "API Key\uFF08\u53EF\u9009\uFF0C\u7559\u7A7A\u5219\u4E0D\u4FEE\u6539\u5DF2\u4FDD\u5B58\u7684 Key\uFF09", className: "ui-field w-full", autoComplete: "off" }), _jsxs("label", { className: "flex items-center gap-2 text-sm text-ink-700", children: [_jsx("input", { type: "checkbox", checked: config.enabled !== false, onChange: (e) => onChange({ enabled: e.target.checked }) }), "\u542F\u7528"] })] }), _jsxs("div", { className: "px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2", children: [_jsx("button", { type: "button", onClick: onCancel, className: "px-4 py-2 text-sm text-ink-600 border border-ink-200 rounded-xl", children: "\u53D6\u6D88" }), _jsx("button", { type: "button", onClick: onSave, className: "ui-btn-primary", children: "\u4FDD\u5B58" })] })] }) }));
}
