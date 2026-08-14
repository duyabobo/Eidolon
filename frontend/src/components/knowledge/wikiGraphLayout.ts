import type { WikiGraphEdge, WikiGraphNode } from "../../api/knowledge";

export interface LayoutNode extends WikiGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export const GRAPH_COLORS = {
  nodeInactive: "#94a3b8",
  nodeInactiveStroke: "#e2e8f0",
  nodeActive: "#6366f1",
  nodeActiveRing: "#e0e7ff",
  nodeActiveStroke: "#4338ca",
  edgeInactive: "#cbd5e1",
  edgeActive: "#6366f1",
  labelInactive: "#64748b",
  labelActive: "#312e81",
};

/** 选中节点 + 出边引用目标。 */
export function collectRelatedNodeIds(
  selectedNodeId: string | null,
  edges: WikiGraphEdge[],
): Set<string> {
  if (!selectedNodeId) return new Set();
  const related = new Set<string>([selectedNodeId]);
  for (const edge of edges) {
    if (edge.source_id === selectedNodeId) related.add(edge.target_id);
  }
  return related;
}

/** 与选中节点相连的边（双向）。 */
export function isEdgeConnectedToNode(edge: WikiGraphEdge, nodeId: string): boolean {
  return edge.source_id === nodeId || edge.target_id === nodeId;
}

export function edgeLabelPosition(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number; rotate: number } {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const offset = 10;
  let rotate = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (rotate > 90 || rotate < -90) rotate += 180;
  return {
    x: mx - (dy / len) * offset,
    y: my + (dx / len) * offset,
    rotate,
  };
}

export function truncateLabel(text: string, max = 18): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function truncateEdgeDescription(text: string, max = 40): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function layoutGraph(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
  width: number,
  height: number,
): LayoutNode[] {
  if (nodes.length === 0) return [];

  const simNodes: LayoutNode[] = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const r = Math.min(width, height) * 0.28;
    return {
      ...n,
      x: width / 2 + Math.cos(angle) * r,
      y: height / 2 + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
    };
  });

  const idIndex = new Map(simNodes.map((n, i) => [n.node_id, i]));
  const simEdges = edges
    .map((e) => ({ s: idIndex.get(e.source_id), t: idIndex.get(e.target_id) }))
    .filter((e): e is { s: number; t: number } => e.s !== undefined && e.t !== undefined);

  const iterations = Math.min(200, 80 + simNodes.length);
  for (let step = 0; step < iterations; step += 1) {
    for (let i = 0; i < simNodes.length; i += 1) {
      for (let j = i + 1; j < simNodes.length; j += 1) {
        const a = simNodes[i];
        const b = simNodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.hypot(dx, dy) || 1;
        const force = 1200 / (dist * dist);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx += dx;
        a.vy += dy;
        b.vx -= dx;
        b.vy -= dy;
      }
    }

    for (const edge of simEdges) {
      const a = simNodes[edge.s];
      const b = simNodes[edge.t];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const force = (dist - 90) * 0.04;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      a.vx += dx;
      a.vy += dy;
      b.vx -= dx;
      b.vy -= dy;
    }

    for (const n of simNodes) {
      n.vx += (width / 2 - n.x) * 0.002;
      n.vy += (height / 2 - n.y) * 0.002;
      n.vx *= 0.85;
      n.vy *= 0.85;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(40, Math.min(width - 40, n.x));
      n.y = Math.max(40, Math.min(height - 40, n.y));
    }
  }

  return simNodes;
}
