import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import WikiInlineMarkdown from "./WikiInlineMarkdown";
export default function WikiConnectionList({ links, onNavigate }) {
    if (!links.length)
        return null;
    return (_jsx("ul", { className: "space-y-2.5", children: links.map((link) => {
            const target = link.nodeId || link.label;
            const clickable = Boolean(target);
            return (_jsxs("li", { className: "text-sm leading-relaxed", children: [clickable ? (_jsx("button", { type: "button", onClick: () => onNavigate(target), className: "text-brand-600 hover:text-brand-700 underline underline-offset-2 font-medium text-left inline", children: _jsx(WikiInlineMarkdown, { content: link.label }) })) : (_jsx(WikiInlineMarkdown, { content: link.label, className: "text-ink-800" })), link.description ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "text-ink-600", children: " \u2014 " }), _jsx(WikiInlineMarkdown, { content: link.description, className: "text-ink-600" })] })) : null] }, `${link.nodeId || link.label}-${link.description}`));
        }) }));
}
