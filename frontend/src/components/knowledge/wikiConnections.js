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
function pickString(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return "";
}
/** 解析「标题 — 描述」或「标题 - 描述」 */
export function parseConnectionLine(text) {
    const trimmed = text.trim();
    const match = trimmed.match(/^(.+?)\s*(?:—|–|-)\s+(.+)$/);
    if (match) {
        return { label: match[1].trim(), description: match[2].trim() };
    }
    return { label: trimmed, description: "" };
}
function titleBeforeParen(title) {
    return title.split(/[（(]/)[0]?.trim() ?? title.trim();
}
/** 在图谱节点中按标题匹配（精确 → 去括号 → 包含） */
export function findNodeByTitle(title, graphNodes) {
    const raw = title.trim();
    if (!raw)
        return undefined;
    const lower = raw.toLowerCase();
    const exact = graphNodes.find((node) => node.title.trim().toLowerCase() === lower);
    if (exact)
        return exact;
    const base = titleBeforeParen(raw).toLowerCase();
    if (base) {
        const byBase = graphNodes.find((node) => node.title.trim().toLowerCase() === base);
        if (byBase)
            return byBase;
        const byContains = graphNodes.find((node) => {
            const nodeTitle = node.title.trim().toLowerCase();
            return nodeTitle.includes(base) || base.includes(nodeTitle);
        });
        if (byContains)
            return byContains;
    }
    return undefined;
}
export function resolveNodeIdFromTitle(title, graphNodes) {
    return findNodeByTitle(title, graphNodes)?.node_id ?? "";
}
export function resolveNavigationTarget(target, graphNodes) {
    const token = target.trim();
    if (!token)
        return null;
    if (graphNodes.some((node) => node.node_id === token)) {
        return token;
    }
    return resolveNodeIdFromTitle(token, graphNodes) || null;
}
function expandConnections(input) {
    if (typeof input === "string") {
        return input.split("\n").map((line) => line.trim()).filter(Boolean);
    }
    if (!Array.isArray(input)) {
        return [];
    }
    const expanded = [];
    for (const item of input) {
        if (typeof item === "string") {
            if (item.includes("\n")) {
                expanded.push(...item.split("\n").map((line) => line.trim()).filter(Boolean));
            }
            else {
                expanded.push(item);
            }
            continue;
        }
        if (item && typeof item === "object") {
            expanded.push(item);
        }
    }
    return expanded;
}
function resolveNodeId(conn, labelHint, graphNodes) {
    const byId = new Map(graphNodes.map((node) => [node.node_id, node]));
    let nodeId = pickString(conn, TARGET_ID_KEYS);
    if (nodeId && byId.has(nodeId)) {
        return nodeId;
    }
    if (labelHint) {
        const fromTitle = resolveNodeIdFromTitle(labelHint, graphNodes);
        if (fromTitle)
            return fromTitle;
    }
    return nodeId;
}
function pushLink(results, seen, nodeId, label, description, graphNodes, currentNodeId) {
    const finalLabel = label.trim();
    if (!finalLabel)
        return;
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
export function resolveWikiConnections(connections, graphNodes, graphEdges = [], currentNodeId) {
    const results = [];
    const seen = new Set();
    for (const raw of expandConnections(connections)) {
        if (typeof raw === "string") {
            const parsed = parseConnectionLine(raw);
            pushLink(results, seen, "", parsed.label, parsed.description, graphNodes, currentNodeId);
            continue;
        }
        const labelHint = pickString(raw, LABEL_KEYS);
        let description = pickString(raw, DESC_KEYS);
        if (!labelHint && !description) {
            const firstString = Object.values(raw).find((value) => typeof value === "string");
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
            if (edge.source_id !== currentNodeId)
                continue;
            const target = graphNodes.find((node) => node.node_id === edge.target_id);
            pushLink(results, seen, edge.target_id, target?.title ?? edge.target_id, edge.description, graphNodes, currentNodeId);
        }
    }
    return results;
}
