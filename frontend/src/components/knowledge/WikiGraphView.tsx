import { useEffect, useMemo, useRef, useState } from "react";
import type { WikiDocumentGraph, WikiGraphEdge, WikiGraphNode } from "../../api/knowledge";
import {
  collectRelatedNodeIds,
  edgeLabelPosition,
  GRAPH_COLORS,
  isEdgeConnectedToNode,
  layoutGraph,
  truncateEdgeDescription,
  truncateLabel,
} from "./wikiGraphLayout";

interface WikiGraphViewProps {
  graph: WikiDocumentGraph;
  selectedNodeId: string | null;
  onNodeClick: (node: WikiGraphNode) => void;
}

const GRAPH_HEIGHT = 420;

function estimateLabelWidth(text: string): number {
  return Math.max(24, text.length * 5.6 + 8);
}

function EdgeDescriptionLabel({
  edge,
  x1,
  y1,
  x2,
  y2,
}: {
  edge: WikiGraphEdge;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) {
  const label = truncateEdgeDescription(edge.description);
  if (!label) return null;

  const { x, y, rotate } = edgeLabelPosition(x1, y1, x2, y2);
  const width = estimateLabelWidth(label);
  const height = 14;

  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotate})`}>
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={3}
        fill="white"
        fillOpacity={0.92}
        stroke={GRAPH_COLORS.edgeActive}
        strokeWidth={0.5}
      />
      <text
        x={0}
        y={4}
        textAnchor="middle"
        className="fill-indigo-900 text-[9px] pointer-events-none select-none"
      >
        {label}
      </text>
      <title>{edge.description.trim()}</title>
    </g>
  );
}

export default function WikiGraphView({ graph, selectedNodeId, onNodeClick }: WikiGraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(Math.max(320, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    setWidth(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const layoutNodes = useMemo(
    () => layoutGraph(graph.nodes, graph.edges, width, GRAPH_HEIGHT),
    [graph.nodes, graph.edges, width],
  );

  const nodeMap = useMemo(
    () => new Map(layoutNodes.map((node) => [node.node_id, node])),
    [layoutNodes],
  );

  const relatedNodeIds = useMemo(
    () => collectRelatedNodeIds(selectedNodeId, graph.edges),
    [selectedNodeId, graph.edges],
  );

  const hasSelection = Boolean(selectedNodeId);

  if (graph.nodes.length === 0) {
    return (
      <div className="border border-dashed border-ink-200 rounded-xl py-16 text-center text-sm text-ink-400">
        暂无 Wiki 节点（文档可能尚未完成 STANDARD + Wiki 入库）
      </div>
    );
  }

  return (
    <div ref={containerRef} className="border border-ink-200/60 rounded-xl overflow-hidden bg-ink-50/30">
      <div className="flex items-center justify-between px-3 py-2 border-b border-ink-200/50 bg-white/60">
        <span className="text-xs text-ink-500">
          {graph.node_count} 节点 · {graph.edge_count} 关系 · {graph.took_ms}ms
        </span>
        <span className="text-[11px] text-ink-400">
          {hasSelection ? "蓝色为选中节点及其关联节点" : "点击节点查看详情与关联关系"}
        </span>
      </div>
      <svg width={width} height={GRAPH_HEIGHT} className="block">
        <defs>
          <marker id="wiki-arrow-gray" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={GRAPH_COLORS.edgeInactive} />
          </marker>
          <marker id="wiki-arrow-blue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={GRAPH_COLORS.edgeActive} />
          </marker>
        </defs>

        {graph.edges.map((edge) => {
          const source = nodeMap.get(edge.source_id);
          const target = nodeMap.get(edge.target_id);
          if (!source || !target) return null;

          const active = hasSelection && selectedNodeId
            ? isEdgeConnectedToNode(edge, selectedNodeId)
            : false;

          return (
            <g key={`${edge.source_id}-${edge.target_id}-${edge.description}`}>
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={active ? GRAPH_COLORS.edgeActive : GRAPH_COLORS.edgeInactive}
                strokeWidth={active ? 2 : 1}
                markerEnd={active ? "url(#wiki-arrow-blue)" : "url(#wiki-arrow-gray)"}
              />
              {active && (
                <EdgeDescriptionLabel
                  edge={edge}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                />
              )}
            </g>
          );
        })}

        {layoutNodes.map((node) => {
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

          return (
            <g
              key={node.node_id}
              className="cursor-pointer"
              onClick={() => onNodeClick(node)}
            >
              {isSelected && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius + 5}
                  fill={GRAPH_COLORS.nodeActiveRing}
                />
              )}
              <circle
                cx={node.x}
                cy={node.y}
                r={radius}
                fill={fill}
                stroke={stroke}
                strokeWidth={isSelected ? 2.5 : isRelated && hasSelection ? 2 : 1.5}
                opacity={hasSelection && !isRelated ? 0.55 : 1}
              />
              <text
                x={node.x}
                y={node.y + radius + 14}
                textAnchor="middle"
                className={`${labelClass} pointer-events-none select-none`}
                opacity={hasSelection && !isRelated ? 0.55 : 1}
              >
                {truncateLabel(node.title)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
