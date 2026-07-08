import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import WikiMarkdown from "./WikiMarkdown";
import { connectionsToMarkdown, resolveWikiConnections } from "./wikiConnections";
function SectionTitle({ children }) {
    return _jsx("h4", { className: "text-xs font-medium text-ink-500 mb-1.5", children: children });
}
export default function WikiNodeDetail({ node, loading, error, graphNodes, graphEdges = [], onNavigateNode, onClose, }) {
    if (!node && !loading && !error)
        return null;
    const bodySections = node
        ? Object.entries(node.body_sections).filter(([, value]) => value?.trim())
        : [];
    const connections = node
        ? resolveWikiConnections(node.connections, graphNodes, graphEdges, node.node_id)
        : [];
    const connectionsMarkdown = connectionsToMarkdown(connections);
    const markdownProps = {
        graphNodes,
        onWikiNodeClick: onNavigateNode,
    };
    return (_jsxs("div", { className: "border border-ink-200/60 rounded-xl overflow-hidden bg-white", children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 border-b border-ink-200/50 bg-ink-50/40", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-sm font-semibold text-ink-900 truncate", children: loading ? "加载节点…" : node?.title ?? "节点详情" }), node && (_jsxs("p", { className: "text-[11px] text-ink-400 mt-0.5", children: [node.type || "wiki", " \u00B7 ", node.node_id.slice(0, 8), "\u2026"] }))] }), _jsx("button", { type: "button", onClick: onClose, className: "text-xs px-2 py-1 border border-ink-200 rounded-lg text-ink-500 hover:bg-ink-50", children: "\u5173\u95ED" })] }), _jsxs("div", { className: "max-h-[480px] overflow-y-auto px-4 py-4 scrollbar-thin", children: [loading && _jsx("p", { className: "text-sm text-ink-400", children: "\u52A0\u8F7D\u4E2D\u2026" }), error && (_jsx("p", { className: "text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700", children: error })), node && !loading && (_jsxs("div", { className: "space-y-5", children: [node.tags.length > 0 && (_jsx("div", { className: "flex flex-wrap gap-1.5", children: node.tags.map((tag) => (_jsx("span", { className: "text-[10px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700", children: tag }, tag))) })), (node.keywords_zh.length > 0 || node.keywords_en.length > 0) && (_jsxs("section", { children: [_jsx(SectionTitle, { children: "\u5173\u952E\u8BCD" }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: [...node.keywords_zh, ...node.keywords_en].map((keyword) => (_jsx("span", { className: "text-[10px] px-2 py-0.5 rounded-full bg-ink-100 text-ink-600", children: keyword }, keyword))) })] })), node.overview && (_jsxs("section", { children: [_jsx(SectionTitle, { children: "\u6458\u8981" }), _jsx(WikiMarkdown, { content: node.overview, ...markdownProps })] })), node.body && (_jsxs("section", { children: [_jsx(SectionTitle, { children: "\u6B63\u6587" }), _jsx(WikiMarkdown, { content: node.body, ...markdownProps })] })), bodySections.map(([sectionKey, sectionBody]) => (_jsxs("section", { children: [_jsx(SectionTitle, { children: sectionKey }), _jsx(WikiMarkdown, { content: sectionBody, ...markdownProps })] }, sectionKey))), node.references && (_jsxs("section", { children: [_jsx(SectionTitle, { children: "\u5F15\u7528" }), _jsx(WikiMarkdown, { content: node.references, ...markdownProps })] })), connectionsMarkdown && (_jsxs("section", { children: [_jsx(SectionTitle, { children: "\u94FE\u63A5" }), _jsx(WikiMarkdown, { content: connectionsMarkdown, ...markdownProps })] }))] }))] })] }));
}
