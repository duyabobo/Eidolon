import type { WikiGraphEdge, WikiGraphNode } from "../../api/knowledge";

const TARGET_ID_KEYS = [
  "target_node_id",
  "node_id",
  "target_id",
  "linked_node_id",
  "wiki_node_id",
  "link_node_id",
  "id",
  "target",
  "link",
];
const LABEL_KEYS = ["title", "name", "target_title", "label", "text", "source_title"];
const DESC_KEYS = ["description", "relation", "type", "link_type", "edge_type", "summary", "intro"];

export interface WikiConnectionLink {
  nodeId: string;
  label: string;
  description: string;
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** 解析「标题 — 描述」或「标题 - 描述」 */
export function parseConnectionLine(text: string): { label: string; description: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^(.+?)\s*(?:—|–|-)\s+(.+)$/);
  if (match) {
    return { label: match[1].trim(), description: match[2].trim() };
  }
  return { label: trimmed, description: "" };
}

function titleBeforeParen(title: string): string {
  return title.split(/[（(]/)[0]?.trim() ?? title.trim();
}

/** 在图谱节点中按标题匹配（精确 → 去括号 → 包含） */
export function findNodeByTitle(title: string, graphNodes: WikiGraphNode[]): WikiGraphNode | undefined {
  const raw = title.trim();
  if (!raw) return undefined;

  const lower = raw.toLowerCase();
  const exact = graphNodes.find((node) => node.title.trim().toLowerCase() === lower);
  if (exact) return exact;

  const base = titleBeforeParen(raw).toLowerCase();
  if (base) {
    const byBase = graphNodes.find((node) => node.title.trim().toLowerCase() === base);
    if (byBase) return byBase;

    const byContains = graphNodes.find((node) => {
      const nodeTitle = node.title.trim().toLowerCase();
      return nodeTitle.includes(base) || base.includes(nodeTitle);
    });
    if (byContains) return byContains;
  }

  return undefined;
}

export function resolveNodeIdFromTitle(title: string, graphNodes: WikiGraphNode[]): string {
  return findNodeByTitle(title, graphNodes)?.node_id ?? "";
}

export function resolveNavigationTarget(
  target: string,
  graphNodes: WikiGraphNode[],
): string | null {
  const token = target.trim();
  if (!token) return null;
  if (graphNodes.some((node) => node.node_id === token)) {
    return token;
  }
  return resolveNodeIdFromTitle(token, graphNodes) || null;
}

function expandConnections(input: unknown): Array<Record<string, unknown> | string> {
  if (typeof input === "string") {
    return input.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  if (!Array.isArray(input)) {
    return [];
  }

  const expanded: Array<Record<string, unknown> | string> = [];
  for (const item of input) {
    if (typeof item === "string") {
      if (item.includes("\n")) {
        expanded.push(...item.split("\n").map((line) => line.trim()).filter(Boolean));
      } else {
        expanded.push(item);
      }
      continue;
    }
    if (item && typeof item === "object") {
      expanded.push(item as Record<string, unknown>);
    }
  }
  return expanded;
}

function resolveNodeId(
  conn: Record<string, unknown>,
  labelHint: string,
  graphNodes: WikiGraphNode[],
): string {
  const byId = new Map(graphNodes.map((node) => [node.node_id, node]));
  let nodeId = pickString(conn, TARGET_ID_KEYS);

  if (nodeId && byId.has(nodeId)) {
    return nodeId;
  }

  if (labelHint) {
    const fromTitle = resolveNodeIdFromTitle(labelHint, graphNodes);
    if (fromTitle) return fromTitle;
  }

  return nodeId;
}

function pushLink(
  results: WikiConnectionLink[],
  seen: Set<string>,
  nodeId: string,
  label: string,
  description: string,
  graphNodes: WikiGraphNode[],
  currentNodeId?: string,
) {
  const finalLabel = label.trim();
  if (!finalLabel) return;

  const resolvedId = nodeId || resolveNodeIdFromTitle(finalLabel, graphNodes);
  const dedupeKey = resolvedId || finalLabel.toLowerCase();
  if (dedupeKey === currentNodeId || seen.has(dedupeKey)) {
    return;
  }

  seen.add(dedupeKey);
  results.push({
    nodeId: resolvedId,
    label: finalLabel,
    description: description.trim(),
  });
}

export function resolveWikiConnections(
  connections: unknown,
  graphNodes: WikiGraphNode[],
  graphEdges: WikiGraphEdge[] = [],
  currentNodeId?: string,
): WikiConnectionLink[] {
  const results: WikiConnectionLink[] = [];
  const seen = new Set<string>();

  for (const raw of expandConnections(connections)) {
    if (typeof raw === "string") {
      const parsed = parseConnectionLine(raw);
      pushLink(
        results,
        seen,
        "",
        parsed.label,
        parsed.description,
        graphNodes,
        currentNodeId,
      );
      continue;
    }

    const labelHint = pickString(raw, LABEL_KEYS);
    let description = pickString(raw, DESC_KEYS);

    if (!labelHint && !description) {
      const firstString = Object.values(raw).find((value) => typeof value === "string") as string | undefined;
      if (firstString) {
        const parsed = parseConnectionLine(firstString);
        pushLink(results, seen, "", parsed.label, parsed.description, graphNodes, currentNodeId);
        continue;
      }
    }

    if (!description && labelHint.includes(" — ")) {
      const parsed = parseConnectionLine(labelHint);
      pushLink(results, seen, "", parsed.label, parsed.description, graphNodes, currentNodeId);
      continue;
    }

    const nodeId = resolveNodeId(raw, labelHint, graphNodes);
    pushLink(results, seen, nodeId, labelHint, description, graphNodes, currentNodeId);
  }

  if (currentNodeId) {
    for (const edge of graphEdges) {
      if (edge.source_id !== currentNodeId) continue;
      const target = graphNodes.find((node) => node.node_id === edge.target_id);
      pushLink(
        results,
        seen,
        edge.target_id,
        target?.title ?? edge.target_id,
        edge.description,
        graphNodes,
        currentNodeId,
      );
    }
  }

  return results;
}
