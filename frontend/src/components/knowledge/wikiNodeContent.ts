import type { WikiNodeItem } from "../../api/knowledge";
import { resolveNodeTitle } from "./WikiNodeMeta";

/** 将 Wiki 节点四段结构拼成单一 Markdown，供弹框直接渲染 */
export function buildWikiNodeMarkdown(node: WikiNodeItem): string {
  const parts: string[] = [];
  const title = resolveNodeTitle(node);
  if (title) {
    parts.push(`# ${title}`);
  }

  const overview = node.overview?.trim() ?? "";
  const body = node.body?.trim() ?? "";
  if (overview && overview !== body) {
    parts.push(`## 摘要\n\n${overview}`);
  }
  if (body) {
    parts.push(`## 详情\n\n${body}`);
  }
  if (node.references?.trim()) {
    parts.push(`## 引用\n\n${node.references.trim()}`);
  }

  return parts.join("\n\n");
}
