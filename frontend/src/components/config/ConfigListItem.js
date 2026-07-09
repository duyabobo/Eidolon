import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function ConfigListItem({ highlighted, leading, title, subtitle, meta, extra, actions, }) {
    const cls = `flex items-start gap-3 border rounded-xl px-4 py-3 ${highlighted ? "border-brand-300 bg-brand-50/40" : "border-ink-200/60"}`;
    return (_jsxs("div", { className: cls, children: [leading, _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [typeof title === "string" ? (_jsx("span", { className: "text-sm font-medium text-ink-800 truncate", children: title })) : (title), meta] }), subtitle && (typeof subtitle === "string" ? (_jsx("p", { className: "text-xs text-ink-400 mt-0.5 truncate", children: subtitle })) : (_jsx("div", { className: "text-xs text-ink-400 mt-0.5", children: subtitle }))), extra] }), actions && (_jsx("div", { className: "flex items-center gap-2 shrink-0 flex-wrap justify-end self-center", children: actions }))] }));
}
export function ScopeBadge({ scope }) {
    return (_jsx("span", { className: `text-[10px] px-1.5 py-0.5 rounded-full font-medium ${scope === "user" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`, children: scope === "user" ? "我的" : "系统" }));
}
