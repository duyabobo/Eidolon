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
const LABEL_KEYS = ["title", "name", "target_title", "target_name", "label", "text", "source_title"];
const DESC_KEYS = ["description", "relation", "type", "link_type", "edge_type", "summary", "intro"];

/** 匹配 [[id|标题]] / [[标题]] / 带 (path) 的历史格式 */
const WIKI_PIPE_LINK_RE = /^\[\[([^\]|]+)\|([^\]]+)\]\](?:\([^)]*\))?$/;
const WIKI_LINK_RE = /^\[\[([^\]]+)\]\](?:\([^)]*\))?$/;
const LIST_PREFIX_RE = /^[-*•]\s+/;
const DESC_ONLY_RE = /^(?:—|–|-)\s+(.+)$/;

export interface WikiConnectionLink {
  nodeId: string;
  label: string;
  description: string;
}

export interface WikiLinkToken {
  nodeId: string;
  title: string;
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

/** 解析 [[node_id|标题]] / [[标题]](path) / 纯文本 */
export function parseWikiLinkToken(raw: string): WikiLinkToken {
  const text = raw.trim().replace(LIST_PREFIX_RE, "").trim();
  const piped = text.match(WIKI_PIPE_LINK_RE);
  if (piped) {
    return { nodeId: piped[1].trim(), title: piped[2].trim() };
  }
  const simple = text.match(WIKI_LINK_RE);
  if (simple) {
    return { nodeId: "", title: simple[1].trim() };
  }
  return { nodeId: "", title: text };
}

/** 去掉列表前缀与 wiki 链接外壳，得到展示用标题 */
export function normalizeWikiRefLabel(raw: string): string {
  return parseWikiLinkToken(raw).title.trim();
}

/** 解析「标题 — 描述」或「标题 - 描述」 */
export function parseConnectionLine(text: string): {
  label: string;
  description: string;
  nodeId: string;
} {
  const trimmed = text.trim().replace(LIST_PREFIX_RE, "").trim();
  const match = trimmed.match(/^(.+?)\s*(?:—|–|-)\s+(.+)$/);
  if (match) {
    const token = parseWikiLinkToken(match[1]);
    return {
      label: token.title,
      description: match[2].trim(),
      nodeId: token.nodeId,
    };
  }
  const token = parseWikiLinkToken(trimmed);
  return { label: token.title, description: "", nodeId: token.nodeId };
}

function titleBeforeParen(title: string): string {
  return title.split(/[（(]/)[0]?.trim() ?? title.trim();
}

/** 在图谱节点中按标题匹配（精确 → 去括号 → 包含） */
export function findNodeByTitle(title: string, graphNodes: WikiGraphNode[]): WikiGraphNode | undefined {
  const raw = normalizeWikiRefLabel(title);
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
  const token = parseWikiLinkToken(target);
  if (token.nodeId && graphNodes.some((node) => node.node_id === token.nodeId)) {
    return token.nodeId;
  }
  const title = token.title.trim();
  if (!title) return null;
  if (graphNodes.some((node) => node.node_id === title)) {
    return title;
  }
  return resolveNodeIdFromTitle(title, graphNodes) || null;
}

/**
 * 把引用正文拆成「标题 + 描述」行。
 * 兼容：同排「标题 — 描述」、以及「[[标题]]\n — 描述」折行。
 */
export function parseReferencesBlock(text: string): Array<{
  label: string;
  description: string;
  nodeId: string;
}> {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const rows: Array<{ label: string; description: string; nodeId: string }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const descOnly = line.match(DESC_ONLY_RE);
    if (descOnly && rows.length > 0 && !rows[rows.length - 1].description) {
      rows[rows.length - 1].description = descOnly[1].trim();
      continue;
    }

    const parsed = parseConnectionLine(line);
    if (!parsed.label) continue;

    const next = lines[i + 1];
    if (!parsed.description && next) {
      const nextDesc = next.match(DESC_ONLY_RE);
      if (nextDesc) {
        parsed.description = nextDesc[1].trim();
        i += 1;
      }
    }

    rows.push(parsed);
  }

  return rows;
}

function expandConnections(input: unknown): Array<Record<string, unknown> | string> {
  if (typeof input === "string") {
    return [input];
  }
  if (!Array.isArray(input)) {
    return [];
  }

  const expanded: Array<Record<string, unknown> | string> = [];
  for (const item of input) {
    if (typeof item === "string") {
      expanded.push(item);
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
  onlyResolved = false,
) {
  const token = parseWikiLinkToken(label);
  const finalLabel = (token.title || label).trim();
  if (!finalLabel) return;

  const byId = new Map(graphNodes.map((node) => [node.node_id, node]));
  let resolvedId = (nodeId || token.nodeId).trim();
  if (resolvedId && !byId.has(resolvedId)) {
    const fromTitle = resolveNodeIdFromTitle(finalLabel, graphNodes);
    if (fromTitle) resolvedId = fromTitle;
    else if (onlyResolved) resolvedId = "";
  }
  if (!resolvedId) {
    resolvedId = resolveNodeIdFromTitle(finalLabel, graphNodes);
  }
  if (onlyResolved && (!resolvedId || !byId.has(resolvedId))) {
    return;
  }

  const dedupeKey = (resolvedId || finalLabel).toLowerCase();
  if (resolvedId && resolvedId === currentNodeId) return;
  if (seen.has(dedupeKey)) return;

  seen.add(dedupeKey);
  results.push({
    nodeId: resolvedId,
    label: byId.get(resolvedId)?.title?.trim() || finalLabel,
    description: description.trim(),
  });
}

export interface ResolveWikiConnectionsOptions {
  /** 是否把图谱树出边并入引用列表；详情「引用」应关闭，避免和语义引用混在一起 */
  includeGraphEdges?: boolean;
  /** 只保留能落到图谱节点的引用，保证与变蓝数量一致 */
  onlyResolved?: boolean;
}

export function resolveWikiConnections(
  connections: unknown,
  graphNodes: WikiGraphNode[],
  graphEdges: WikiGraphEdge[] = [],
  currentNodeId?: string,
  options: ResolveWikiConnectionsOptions = {},
): WikiConnectionLink[] {
  const includeGraphEdges = options.includeGraphEdges ?? false;
  const onlyResolved = options.onlyResolved ?? false;
  const results: WikiConnectionLink[] = [];
  const seen = new Set<string>();

  const push = (
    nodeId: string,
    label: string,
    description: string,
  ) => {
    pushLink(
      results,
      seen,
      nodeId,
      label,
      description,
      graphNodes,
      currentNodeId,
      onlyResolved,
    );
  };

  for (const raw of expandConnections(connections)) {
    if (typeof raw === "string") {
      for (const parsed of parseReferencesBlock(raw)) {
        push(parsed.nodeId, parsed.label, parsed.description);
      }
      continue;
    }

    const labelHint = normalizeWikiRefLabel(pickString(raw, LABEL_KEYS));
    let description = pickString(raw, DESC_KEYS);

    if (!labelHint && !description) {
      const firstString = Object.values(raw).find((value) => typeof value === "string") as string | undefined;
      if (firstString) {
        for (const parsed of parseReferencesBlock(firstString)) {
          push(parsed.nodeId, parsed.label, parsed.description);
        }
        continue;
      }
    }

    if (!description && (labelHint.includes(" — ") || labelHint.includes("[["))) {
      const parsed = parseConnectionLine(labelHint);
      push(parsed.nodeId, parsed.label, parsed.description);
      continue;
    }

    const nodeId = resolveNodeId(raw, labelHint, graphNodes);
    push(nodeId, labelHint, description);
  }

  if (includeGraphEdges && currentNodeId) {
    for (const edge of graphEdges) {
      if (edge.source_id !== currentNodeId) continue;
      const target = graphNodes.find((node) => node.node_id === edge.target_id);
      push(
        edge.target_id,
        target?.title ?? edge.target_id,
        edge.description,
      );
    }
  }

  return results;
}

/** 选中节点 + 引用目标，供图谱高亮与引用列表对齐 */
export function collectReferenceHighlightIds(
  selectedNodeId: string | null,
  links: WikiConnectionLink[],
): Set<string> {
  if (!selectedNodeId) return new Set();
  const related = new Set<string>([selectedNodeId]);
  for (const link of links) {
    if (link.nodeId) related.add(link.nodeId);
  }
  return related;
}
