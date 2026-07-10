import { normalizeWikiNodeLinks } from "./chatMarkdownPreprocess";
export const CITE_REF_PREFIX = "cite-ref:";
const REF_SECTION_HEADING = /^##\s*参考来源\s*$/m;
const REF_LINE = /^\s*(\d+)\.\s+\[([^\]]+)\]\(([^)]+)\)(?:\s*[—\-–]\s*(.+))?$/;
export function isCiteRefHref(href) {
    return Boolean(href?.startsWith(CITE_REF_PREFIX));
}
export function citeRefNumberFromHref(href) {
    return Number(href.slice(CITE_REF_PREFIX.length));
}
/** 解析「参考来源」列表，并将正文中的 [1] 转为可点击上标链接 */
export function parseChatCitations(content) {
    const normalized = normalizeWikiNodeLinks(content);
    const headingMatch = normalized.match(REF_SECTION_HEADING);
    if (!headingMatch || headingMatch.index === undefined) {
        return { markdown: normalized, refs: new Map() };
    }
    const body = normalized.slice(0, headingMatch.index).trimEnd();
    const refSection = normalized.slice(headingMatch.index);
    const refs = new Map();
    for (const line of refSection.split("\n")) {
        const matched = line.match(REF_LINE);
        if (!matched)
            continue;
        refs.set(Number(matched[1]), {
            label: matched[2].trim(),
            href: matched[3].trim(),
            description: matched[4]?.trim(),
        });
    }
    let processedBody = body;
    if (refs.size > 0) {
        processedBody = body.replace(/(?<!\])\[\d+\](?!\()/g, (token) => {
            const num = Number(token.slice(1, -1));
            if (!refs.has(num))
                return token;
            return `[${num}](${CITE_REF_PREFIX}${num})`;
        });
    }
    return {
        markdown: processedBody ? `${processedBody}\n\n${refSection}` : refSection,
        refs,
    };
}
