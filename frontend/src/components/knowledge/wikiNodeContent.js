import { isMetadataBodySection, resolveNodeTitle } from "./WikiNodeMeta";
/** 将 Wiki 节点各字段拼成单一 Markdown 文档，供弹框直接渲染 */
export function buildWikiNodeMarkdown(node) {
    const parts = [];
    const title = resolveNodeTitle(node);
    if (title) {
        parts.push(`# ${title}`);
    }
    if (node.overview?.trim()) {
        parts.push(node.overview.trim());
    }
    if (node.body?.trim()) {
        parts.push(node.body.trim());
    }
    for (const [sectionKey, sectionBody] of Object.entries(node.body_sections ?? {})) {
        if (!sectionBody?.trim())
            continue;
        if (sectionKey.toLowerCase() === "connections" || sectionKey === "链接")
            continue;
        if (isMetadataBodySection(sectionKey))
            continue;
        parts.push(`## ${sectionKey}\n\n${sectionBody.trim()}`);
    }
    if (node.references?.trim()) {
        parts.push(`## 引用\n\n${node.references.trim()}`);
    }
    return parts.join("\n\n");
}
