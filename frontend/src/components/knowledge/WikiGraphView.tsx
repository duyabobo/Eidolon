import { useEffect, useMemo, useRef, useState } from "react";
import type { WikiDocumentGraph, WikiGraphNode } from "../../api/knowledge";
import { layoutGraph, nodeColor, truncateLabel } from "./wikiGraphLayout";

interface WikiGraphViewProps {
  graph: WikiDocumentGraph;
  selectedNodeId: string | null;
  onNodeClick: (node: WikiGraphNode) => void;
}

const GRAPH_HEIGHT = 420;

export default function WikiGraphView({ graph, selectedNodeId, onNodeClick }: WikiGraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hoverId, setHoverId] = useState<string | null>(null);

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
    () => new Map(layoutNodes.map((n) => [n.node_id, n])),
    [layoutNodes],
  );

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
        <span className="text-[11px] text-ink-400">点击节点查看详情</span>
      </div>
      <svg width={width} height={GRAPH_HEIGHT} className="block">
        <defs>
          <marker id="wiki-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#cbd5e1" />
          </marker>
        </defs>
        {graph.edges.map((edge) => {
          const s = nodeMap.get(edge.source_id);
          const t = nodeMap.get(edge.target_id);
          if (!s || !t) return null;
          const active = hoverId === edge.source_id || hoverId === edge.target_id
            || selectedNodeId === edge.source_id || selectedNodeId === edge.target_id;
          return (
            <g key={`${edge.source_id}-${edge.target_id}-${edge.description}`}>
              <line
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={active ? "#818cf8" : "#cbd5e1"}
                strokeWidth={active ? 2 : 1}
                markerEnd="url(#wiki-arrow)"
              />
            </g>
          );
        })}
        {layoutNodes.map((node) => {
          const selected = selectedNodeId === node.node_id;
          const hover = hoverId === node.node_id;
          const r = selected ? 14 : hover ? 12 : 10;
          return (
            <g
              key={node.node_id}
              className="cursor-pointer"
              onMouseEnter={() => setHoverId(node.node_id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={() => onNodeClick(node)}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={r + 4}
                fill={selected ? "#e0e7ff" : "transparent"}
              />
              <circle
                cx={node.x}
                cy={node.y}
                r={r}
                fill={nodeColor(node.type)}
                stroke={selected ? "#4338ca" : "#fff"}
                strokeWidth={selected ? 2.5 : 1.5}
              />
              <text
                x={node.x}
                y={node.y + r + 14}
                textAnchor="middle"
                className="fill-ink-700 text-[10px] pointer-events-none select-none"
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
