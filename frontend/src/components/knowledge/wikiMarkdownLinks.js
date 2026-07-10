import { findNodeByTitle, parseConnectionLine } from "./wikiConnections";
export const WIKI_NODE_LINK_PREFIX = "wiki-node:";
const WIKI_NODE_HREF_PATTERN = /^wiki-node:(?:\/\/)?/i;
export function buildTitleNodeIndex(graphNodes) {
    const index = new Map();
    for (const node of graphNodes) {
        const title = node.title.trim();
        const lower = title.toLowerCase();
        if (lower && !index.has(lower)) {
            index.set(lower, node.node_id);
        }
        const base = title.split(/[（(]/)[0]?.trim().toLowerCase();
        if (base && !index.has(base)) {
            index.set(base, node.node_id);
        }
    }
    return index;
}
/** 将「标题 — 描述」行转为 wiki 内链 markdown */
export function preprocessConnectionLines(content, graphNodes) {
    return content
        .split("\n")
        .map((line) => {
        const trimmed = line.trim();
        if (!trimmed)
            return line;
        const parsed = parseConnectionLine(trimmed);
        if (!parsed.description)
            return line;
        const node = findNodeByTitle(parsed.label, graphNodes);
        if (!node)
            return line;
        return `[${parsed.label}](${WIKI_NODE_LINK_PREFIX}${node.node_id}) — ${parsed.description}`;
    })
        .join("\n");
}
/** 将 [[标题]] / [[node_id|标题]] 转为可点击的 wiki 内链 */
export function preprocessWikiMarkdown(content, titleIndex) {
    let text = content;
    text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, nodeId, title) => `[${title.trim()}](${WIKI_NODE_LINK_PREFIX}${nodeId.trim()})`);
    text = text.replace(/\[\[([^\]]+)\]\]/g, (match, inner) => {
        const token = inner.trim();
        if (!token)
            return match;
        if (token.startsWith(WIKI_NODE_LINK_PREFIX)) {
            const nodeId = token.slice(WIKI_NODE_LINK_PREFIX.length);
            return `[${nodeId}](${WIKI_NODE_LINK_PREFIX}${nodeId})`;
        }
        const byTitle = titleIndex.get(token.toLowerCase());
        if (byTitle) {
            return `[${token}](${WIKI_NODE_LINK_PREFIX}${byTitle})`;
        }
        if (/^[\w-]{8,}$/.test(token)) {
            return `[${token}](${WIKI_NODE_LINK_PREFIX}${token})`;
        }
        return match;
    });
    return text;
}
export function isWikiNodeHref(href) {
    return Boolean(href && WIKI_NODE_HREF_PATTERN.test(href));
}
export function wikiNodeIdFromHref(href) {
    return href.replace(WIKI_NODE_HREF_PATTERN, "");
}
