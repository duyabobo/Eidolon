import type { WikiNodeItem } from "../../api/knowledge";

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

interface WikiNodeMetaProps {
  node: WikiNodeItem;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-500 shrink-0">{label}</dt>
      <dd className="text-ink-900 break-words">{value || "—"}</dd>
    </>
  );
}

export default function WikiNodeMeta({ node }: WikiNodeMetaProps) {
  const title = resolveNodeTitle(node);
  const type = resolveNodeType(node);
  const source =
    (node.source || node.source_doc_id || "").trim() ||
    (node.metadata ? pickMetaString(node.metadata, ["source", "source_doc_id"]) : "");
  const sourceDate =
    (node.source_date || "").trim() ||
    (node.metadata ? pickMetaString(node.metadata, ["source_date", "source_publication_date"]) : "");

  return (
    <section>
      <h4 className="text-xs font-medium text-ink-500 mb-1.5">元数据</h4>
      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-sm leading-relaxed">
        <MetaRow label="名称" value={title} />
        <MetaRow label="类型" value={type} />
        <MetaRow label="来源" value={source} />
        <MetaRow label="日期" value={sourceDate} />
      </dl>
    </section>
  );
}

export function isMetadataBodySection(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === "metadata" || key === "元数据";
}
