import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { collectRelatedNodeIds, edgeLabelPosition, GRAPH_COLORS, isEdgeConnectedToNode, layoutGraph, truncateEdgeDescription, truncateLabel, } from "./wikiGraphLayout";
const GRAPH_HEIGHT = 420;
function estimateLabelWidth(text) {
    return Math.max(24, text.length * 5.6 + 8);
}
function EdgeDescriptionLabel({ edge, x1, y1, x2, y2, }) {
    const label = truncateEdgeDescription(edge.description);
    if (!label)
        return null;
    const { x, y, rotate } = edgeLabelPosition(x1, y1, x2, y2);
    const width = estimateLabelWidth(label);
    const height = 14;
    return (_jsxs("g", { transform: `translate(${x}, ${y}) rotate(${rotate})`, children: [_jsx("rect", { x: -width / 2, y: -height / 2, width: width, height: height, rx: 3, fill: "white", fillOpacity: 0.92, stroke: GRAPH_COLORS.edgeActive, strokeWidth: 0.5 }), _jsx("text", { x: 0, y: 4, textAnchor: "middle", className: "fill-indigo-900 text-[9px] pointer-events-none select-none", children: label }), _jsx("title", { children: edge.description.trim() })] }));
}
export default function WikiGraphView({ graph, selectedNodeId, onNodeClick }) {
    const containerRef = useRef(null);
    const [width, setWidth] = useState(640);
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
    const nodeMap = useMemo(() => new Map(layoutNodes.map((node) => [node.node_id, node])), [layoutNodes]);
    const relatedNodeIds = useMemo(() => collectRelatedNodeIds(selectedNodeId, graph.edges), [selectedNodeId, graph.edges]);
    const hasSelection = Boolean(selectedNodeId);
    if (graph.nodes.length === 0) {
        return (_jsx("div", { className: "border border-dashed border-ink-200 rounded-xl py-16 text-center text-sm text-ink-400", children: "\u6682\u65E0 Wiki \u8282\u70B9\uFF08\u6587\u6863\u53EF\u80FD\u5C1A\u672A\u5B8C\u6210 STANDARD + Wiki \u5165\u5E93\uFF09" }));
    }
    return (_jsxs("div", { ref: containerRef, className: "border border-ink-200/60 rounded-xl overflow-hidden bg-ink-50/30", children: [_jsxs("div", { className: "flex items-center justify-between px-3 py-2 border-b border-ink-200/50 bg-white/60", children: [_jsxs("span", { className: "text-xs text-ink-500", children: [graph.node_count, " \u8282\u70B9 \u00B7 ", graph.edge_count, " \u5173\u7CFB \u00B7 ", graph.took_ms, "ms"] }), _jsx("span", { className: "text-[11px] text-ink-400", children: hasSelection ? "蓝色为选中节点及其 Connections 出边（不含入边）" : "点击节点查看详情与关联关系" })] }), _jsxs("svg", { width: width, height: GRAPH_HEIGHT, className: "block", children: [_jsxs("defs", { children: [_jsx("marker", { id: "wiki-arrow-gray", markerWidth: "8", markerHeight: "8", refX: "6", refY: "3", orient: "auto", children: _jsx("path", { d: "M0,0 L6,3 L0,6 Z", fill: GRAPH_COLORS.edgeInactive }) }), _jsx("marker", { id: "wiki-arrow-blue", markerWidth: "8", markerHeight: "8", refX: "6", refY: "3", orient: "auto", children: _jsx("path", { d: "M0,0 L6,3 L0,6 Z", fill: GRAPH_COLORS.edgeActive }) })] }), graph.edges.map((edge) => {
                        const source = nodeMap.get(edge.source_id);
                        const target = nodeMap.get(edge.target_id);
                        if (!source || !target)
                            return null;
                        const active = hasSelection && selectedNodeId
                            ? isEdgeConnectedToNode(edge, selectedNodeId)
                            : false;
                        return (_jsxs("g", { children: [_jsx("line", { x1: source.x, y1: source.y, x2: target.x, y2: target.y, stroke: active ? GRAPH_COLORS.edgeActive : GRAPH_COLORS.edgeInactive, strokeWidth: active ? 2 : 1, markerEnd: active ? "url(#wiki-arrow-blue)" : "url(#wiki-arrow-gray)" }), active && (_jsx(EdgeDescriptionLabel, { edge: edge, x1: source.x, y1: source.y, x2: target.x, y2: target.y }))] }, `${edge.source_id}-${edge.target_id}-${edge.description}`));
                    }), layoutNodes.map((node) => {
                        const isSelected = selectedNodeId === node.node_id;
                        const isRelated = relatedNodeIds.has(node.node_id);
                        const isActive = !hasSelection || isRelated;
                        const radius = isSelected ? 14 : isRelated && hasSelection ? 12 : 10;
                        const fill = isActive && hasSelection
                            ? GRAPH_COLORS.nodeActive
                            : GRAPH_COLORS.nodeInactive;
                        const stroke = isSelected
                            ? GRAPH_COLORS.nodeActiveStroke
                            : isRelated && hasSelection
                                ? GRAPH_COLORS.nodeActiveStroke
                                : GRAPH_COLORS.nodeInactiveStroke;
                        const labelClass = isActive && hasSelection
                            ? "fill-indigo-900 text-[10px] font-medium"
                            : "fill-ink-500 text-[10px]";
                        return (_jsxs("g", { className: "cursor-pointer", onClick: () => onNodeClick(node), children: [isSelected && (_jsx("circle", { cx: node.x, cy: node.y, r: radius + 5, fill: GRAPH_COLORS.nodeActiveRing })), _jsx("circle", { cx: node.x, cy: node.y, r: radius, fill: fill, stroke: stroke, strokeWidth: isSelected ? 2.5 : isRelated && hasSelection ? 2 : 1.5, opacity: hasSelection && !isRelated ? 0.55 : 1 }), _jsx("text", { x: node.x, y: node.y + radius + 14, textAnchor: "middle", className: `${labelClass} pointer-events-none select-none`, opacity: hasSelection && !isRelated ? 0.55 : 1, children: truncateLabel(node.title) })] }, node.node_id));
                    })] })] }));
}
