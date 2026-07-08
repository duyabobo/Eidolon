import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export default function WikiConnectionList({ links, onNavigate }) {
    if (!links.length)
        return null;
    return (_jsx("ul", { className: "space-y-2.5", children: links.map((link) => {
            const target = link.nodeId || link.label;
            const clickable = Boolean(target);
            return (_jsxs("li", { className: "text-sm leading-relaxed", children: [clickable ? (_jsx("button", { type: "button", onClick: () => onNavigate(target), className: "text-brand-600 hover:text-brand-700 underline underline-offset-2 font-medium text-left", children: link.label })) : (_jsx("span", { className: "text-ink-800", children: link.label })), link.description && (_jsx("span", { className: "text-ink-600", children: ` — ${link.description}` }))] }, `${link.nodeId || link.label}-${link.description}`));
        }) }));
}
