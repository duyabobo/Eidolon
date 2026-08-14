import type { WikiNodeItem } from "../../api/knowledge";
import WikiInlineMarkdown from "./WikiInlineMarkdown";

function pickMetaString(metadata: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function resolveNodeTitle(node: WikiNodeItem): string {
  const fromMeta = node.metadata
    ? pickMetaString(node.metadata, ["title", "name", "名称"])
    : "";
  return fromMeta || node.title.trim();
}

export function resolveNodeType(node: WikiNodeItem): string {
  const fromMeta = node.metadata
    ? pickMetaString(node.metadata, ["type", "类型"])
    : "";
  return fromMeta || node.type.trim();
}

/** 仅展示 pi 相对路径类来源；隐藏宿主机绝对路径 */
export function displayWikiSource(source: string): string {
  const raw = source.trim();
  if (!raw) return "";
  if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) return "";
  if (raw.includes("Application Support") || raw.includes("sandboxes/")) return "";
  if (raw.includes("\\Users\\") || raw.includes("/Users/")) return "";
  return raw;
}

interface WikiNodeMetaProps {
  node: WikiNodeItem;
}

function MetaRow({ label, value, markdown = false }: { label: string; value: string; markdown?: boolean }) {
  return (
    <>
      <dt className="text-ink-500 shrink-0">{label}</dt>
      <dd className="text-ink-900 break-words min-w-0">
        {!value ? (
          "—"
        ) : markdown ? (
          <WikiInlineMarkdown content={value} />
        ) : (
          value
        )}
      </dd>
    </>
  );
}

export default function WikiNodeMeta({ node }: WikiNodeMetaProps) {
  const title = resolveNodeTitle(node);
  const type = resolveNodeType(node);
  const sourceRaw =
    (node.source || "").trim() ||
    (node.metadata ? pickMetaString(node.metadata, ["source"]) : "");
  const source = displayWikiSource(sourceRaw);
  const sourceDate =
    (node.source_date || "").trim() ||
    (node.metadata ? pickMetaString(node.metadata, ["source_date", "source_publication_date"]) : "") ||
    (node.created_at || "").trim() ||
    (node.metadata ? pickMetaString(node.metadata, ["created_at"]) : "");

  return (
    <section>
      <h4 className="text-base font-bold text-ink-900 mb-2.5">元数据</h4>
      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-sm leading-relaxed">
        <MetaRow label="名称" value={title} markdown />
        <MetaRow label="类型" value={type} />
        {source ? <MetaRow label="来源" value={source} markdown /> : null}
        <MetaRow label="日期" value={sourceDate} />
      </dl>
    </section>
  );
}

export function isMetadataBodySection(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === "metadata" || key === "元数据";
}
