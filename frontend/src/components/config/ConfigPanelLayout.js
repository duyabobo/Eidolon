import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ConfigToolbarBtn } from "./ConfigActionBtn";
export function ConfigPanelLayout({ loading, loadingText = "加载中…", errMsg, toolbar, pagination, children, }) {
    if (loading) {
        return _jsx("p", { className: "text-sm text-ink-400 py-6", children: loadingText });
    }
    return (_jsxs("div", { className: "space-y-4", children: [toolbar, errMsg && (_jsx("p", { className: "text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700", children: errMsg })), children, pagination] }));
}
export function ConfigListToolbar({ left, right }) {
    return (_jsxs("div", { className: "flex items-center justify-between gap-3 flex-wrap", children: [_jsx("div", { className: "flex items-center gap-2 min-w-0 flex-1", children: left }), _jsx("div", { className: "flex items-center gap-2 shrink-0 flex-wrap justify-end", children: right })] }));
}
export function ConfigEmptyState({ message }) {
    return (_jsx("p", { className: "text-sm text-ink-400 text-center py-10 border border-dashed border-ink-200 rounded-xl", children: message }));
}
export function ConfigListPagination({ page, pageSize, total, onPageChange, }) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (total <= pageSize)
        return null;
    return (_jsxs("div", { className: "flex items-center justify-between gap-3 pt-1", children: [_jsxs("p", { className: "text-xs text-ink-400", children: ["\u5171 ", total, " \u6761 \u00B7 \u7B2C ", page, "/", totalPages, " \u9875"] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(ConfigToolbarBtn, { disabled: page <= 1, onClick: () => onPageChange(page - 1), children: "\u4E0A\u4E00\u9875" }), _jsx(ConfigToolbarBtn, { disabled: page >= totalPages, onClick: () => onPageChange(page + 1), children: "\u4E0B\u4E00\u9875" })] })] }));
}
