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
const LABEL_KEYS = ["title", "name", "target_title", "label", "text"];
const DESC_KEYS = ["description", "relation", "type", "link_type", "edge_type"];

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

function resolveNodeId(
  conn: Record<string, unknown>,
  labelHint: string,
  byId: Map<string, WikiGraphNode>,
  byTitle: Map<string, WikiGraphNode>,
): string {
  let nodeId = pickString(conn, TARGET_ID_KEYS);
  if (nodeId && byId.has(nodeId)) {
    return nodeId;
  }

  if (!nodeId && labelHint) {
    nodeId = byTitle.get(labelHint.toLowerCase())?.node_id ?? "";
  }

  if (nodeId && !byId.has(nodeId) && labelHint) {
    const byLabel = byTitle.get(labelHint.toLowerCase())?.node_id;
    if (byLabel) return byLabel;
  }

  return nodeId;
}

function pushLink(
  results: WikiConnectionLink[],
  seen: Set<string>,
  nodeId: string,
  label: string,
  description: string,
  byId: Map<string, WikiGraphNode>,
  currentNodeId?: string,
) {
  if (!nodeId || nodeId === currentNodeId || seen.has(nodeId)) {
    return;
  }
  seen.add(nodeId);
  const node = byId.get(nodeId);
  results.push({
    nodeId,
    label: label || node?.title || nodeId,
    description,
  });
}

export function resolveWikiConnections(
  connections: Array<Record<string, unknown> | string>,
  graphNodes: WikiGraphNode[],
  graphEdges: WikiGraphEdge[] = [],
  currentNodeId?: string,
): WikiConnectionLink[] {
  const byId = new Map(graphNodes.map((node) => [node.node_id, node]));
  const byTitle = new Map(graphNodes.map((node) => [node.title.trim().toLowerCase(), node]));

  const results: WikiConnectionLink[] = [];
  const seen = new Set<string>();

  for (const raw of connections) {
    if (typeof raw === "string") {
      const title = raw.trim();
      const nodeId = byTitle.get(title.toLowerCase())?.node_id ?? "";
      pushLink(results, seen, nodeId, title, "", byId, currentNodeId);
      continue;
    }

    const conn = raw;
    const labelHint = pickString(conn, LABEL_KEYS);
    const description = pickString(conn, DESC_KEYS);
    const nodeId = resolveNodeId(conn, labelHint, byId, byTitle);
    pushLink(results, seen, nodeId, labelHint, description, byId, currentNodeId);
  }

  if (currentNodeId) {
    for (const edge of graphEdges) {
      if (edge.source_id !== currentNodeId) continue;
      const target = byId.get(edge.target_id);
      pushLink(
        results,
        seen,
        edge.target_id,
        target?.title ?? edge.target_id,
        edge.description,
        byId,
        currentNodeId,
      );
    }
  }

  return results;
}

export function connectionsToMarkdown(links: WikiConnectionLink[]): string {
  if (!links.length) return "";
  return links
    .map((link) => {
      const desc = link.description ? ` — ${link.description}` : "";
      return `- [${link.label}](wiki-node:${link.nodeId})${desc}`;
    })
    .join("\n");
}
