import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { layoutGraph, nodeColor, truncateLabel } from "./wikiGraphLayout";
const GRAPH_HEIGHT = 420;
export default function WikiGraphView({ graph, selectedNodeId, onNodeClick }) {
    const containerRef = useRef(null);
    const [width, setWidth] = useState(640);
    const [hoverId, setHoverId] = useState(null);
    useEffect(() => {
        const el = containerRef.current;
        if (!el)
            return;
        const ro = new ResizeObserver(([entry]) => {
            setWidth(Math.max(320, Math.floor(entry.contentRect.width)));
        });
        ro.observe(el);
        setWidth(Math.max(320, el.clientWidth));
        return () => ro.disconnect();
    }, []);
    const layoutNodes = useMemo(() => layoutGraph(graph.nodes, graph.edges, width, GRAPH_HEIGHT), [graph.nodes, graph.edges, width]);
    const nodeMap = useMemo(() => new Map(layoutNodes.map((n) => [n.node_id, n])), [layoutNodes]);
    if (graph.nodes.length === 0) {
        return (_jsx("div", { className: "border border-dashed border-ink-200 rounded-xl py-16 text-center text-sm text-ink-400", children: "\u6682\u65E0 Wiki \u8282\u70B9\uFF08\u6587\u6863\u53EF\u80FD\u5C1A\u672A\u5B8C\u6210 STANDARD + Wiki \u5165\u5E93\uFF09" }));
    }
    return (_jsxs("div", { ref: containerRef, className: "border border-ink-200/60 rounded-xl overflow-hidden bg-ink-50/30", children: [_jsxs("div", { className: "flex items-center justify-between px-3 py-2 border-b border-ink-200/50 bg-white/60", children: [_jsxs("span", { className: "text-xs text-ink-500", children: [graph.node_count, " \u8282\u70B9 \u00B7 ", graph.edge_count, " \u5173\u7CFB \u00B7 ", graph.took_ms, "ms"] }), _jsx("span", { className: "text-[11px] text-ink-400", children: "\u70B9\u51FB\u8282\u70B9\u67E5\u770B\u8BE6\u60C5" })] }), _jsxs("svg", { width: width, height: GRAPH_HEIGHT, className: "block", children: [_jsx("defs", { children: _jsx("marker", { id: "wiki-arrow", markerWidth: "8", markerHeight: "8", refX: "6", refY: "3", orient: "auto", children: _jsx("path", { d: "M0,0 L6,3 L0,6 Z", fill: "#cbd5e1" }) }) }), graph.edges.map((edge) => {
                        const s = nodeMap.get(edge.source_id);
                        const t = nodeMap.get(edge.target_id);
                        if (!s || !t)
                            return null;
                        const active = hoverId === edge.source_id || hoverId === edge.target_id
                            || selectedNodeId === edge.source_id || selectedNodeId === edge.target_id;
                        return (_jsx("g", { children: _jsx("line", { x1: s.x, y1: s.y, x2: t.x, y2: t.y, stroke: active ? "#818cf8" : "#cbd5e1", strokeWidth: active ? 2 : 1, markerEnd: "url(#wiki-arrow)" }) }, `${edge.source_id}-${edge.target_id}-${edge.description}`));
                    }), layoutNodes.map((node) => {
                        const selected = selectedNodeId === node.node_id;
                        const hover = hoverId === node.node_id;
                        const r = selected ? 14 : hover ? 12 : 10;
                        return (_jsxs("g", { className: "cursor-pointer", onMouseEnter: () => setHoverId(node.node_id), onMouseLeave: () => setHoverId(null), onClick: () => onNodeClick(node), children: [_jsx("circle", { cx: node.x, cy: node.y, r: r + 4, fill: selected ? "#e0e7ff" : "transparent" }), _jsx("circle", { cx: node.x, cy: node.y, r: r, fill: nodeColor(node.type), stroke: selected ? "#4338ca" : "#fff", strokeWidth: selected ? 2.5 : 1.5 }), _jsx("text", { x: node.x, y: node.y + r + 14, textAnchor: "middle", className: "fill-ink-700 text-[10px] pointer-events-none select-none", children: truncateLabel(node.title) })] }, node.node_id));
                    })] })] }));
}
