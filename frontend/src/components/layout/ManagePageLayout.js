import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export default function ManagePageLayout({ title, children }) {
    return (_jsx("div", { className: "h-full overflow-y-auto scrollbar-thin", children: _jsxs("div", { className: "page-content py-8", children: [_jsx("h1", { className: "text-xl font-semibold text-ink-900 mb-6 tracking-tight", children: title }), _jsx("div", { className: "bg-white/80 backdrop-blur-sm rounded-2xl border border-ink-200/60 shadow-soft p-6", children: children })] }) }));
}
