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
/** 将「标题 — 描述」行转为 wiki 内链 markdown（跳过 HTML，避免破坏 OCR table） */
export function preprocessConnectionLines(content, graphNodes) {
    return content
        .split("\n")
        .map((line) => {
        const trimmed = line.trim();
        if (!trimmed)
            return line;
        // HTML 行（含 <table>）不做 connection 解析，防止把单元格内容误改成链接
        if (/<\/?[a-z][\w:-]*\b/i.test(trimmed))
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
/**
 * react-markdown v10 默认只放行 https/http/mailto 等协议。
 * 此函数在默认白名单基础上额外放行 wiki-node: 协议，其余保持原有安全过滤。
 */
const ALLOWED_PROTOCOL = /^(https?|ircs?|mailto|xmpp|wiki-node|cite-ref)$/i;
export function wikiAwareUrlTransform(url) {
    const colon = url.indexOf(":");
    const slash = url.indexOf("/");
    const questionMark = url.indexOf("?");
    const numberSign = url.indexOf("#");
    if (colon === -1 ||
        (slash !== -1 && colon > slash) ||
        (questionMark !== -1 && colon > questionMark) ||
        (numberSign !== -1 && colon > numberSign) ||
        ALLOWED_PROTOCOL.test(url.slice(0, colon))) {
        return url;
    }
    return "";
}
