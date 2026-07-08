export const WIKI_NODE_LINK_PREFIX = "wiki-node:";
export function buildTitleNodeIndex(graphNodes) {
    const index = new Map();
    for (const node of graphNodes) {
        const key = node.title.trim().toLowerCase();
        if (key && !index.has(key)) {
            index.set(key, node.node_id);
        }
    }
    return index;
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
    return Boolean(href?.startsWith(WIKI_NODE_LINK_PREFIX));
}
export function wikiNodeIdFromHref(href) {
    return href.slice(WIKI_NODE_LINK_PREFIX.length);
}
