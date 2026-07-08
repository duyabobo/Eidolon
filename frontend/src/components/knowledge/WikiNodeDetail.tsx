import type { WikiGraphEdge, WikiGraphNode, WikiNodeItem } from "../../api/knowledge";
import WikiMarkdown from "./WikiMarkdown";
import { connectionsToMarkdown, resolveWikiConnections } from "./wikiConnections";

interface WikiNodeDetailProps {
  node: WikiNodeItem | null;
  loading: boolean;
  error: string | null;
  graphNodes: WikiGraphNode[];
  graphEdges?: WikiGraphEdge[];
  onNavigateNode: (nodeId: string) => void;
  onClose: () => void;
}

function SectionTitle({ children }: { children: string }) {
  return <h4 className="text-xs font-medium text-ink-500 mb-1.5">{children}</h4>;
}

export default function WikiNodeDetail({
  node,
  loading,
  error,
  graphNodes,
  graphEdges = [],
  onNavigateNode,
  onClose,
}: WikiNodeDetailProps) {
  if (!node && !loading && !error) return null;

  const bodySections = node
    ? Object.entries(node.body_sections).filter(([, value]) => value?.trim())
    : [];
  const connections = node
    ? resolveWikiConnections(node.connections, graphNodes, graphEdges, node.node_id)
    : [];
  const connectionsMarkdown = connectionsToMarkdown(connections);

  const markdownProps = {
    graphNodes,
    onWikiNodeClick: onNavigateNode,
  };

  return (
    <div className="border border-ink-200/60 rounded-xl overflow-hidden bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200/50 bg-ink-50/40">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900 truncate">
            {loading ? "加载节点…" : node?.title ?? "节点详情"}
          </p>
          {node && (
            <p className="text-[11px] text-ink-400 mt-0.5">
              {node.type || "wiki"} · {node.node_id.slice(0, 8)}…
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 border border-ink-200 rounded-lg text-ink-500 hover:bg-ink-50"
        >
          关闭
        </button>
      </div>

      <div className="max-h-[480px] overflow-y-auto px-4 py-4 scrollbar-thin">
        {loading && <p className="text-sm text-ink-400">加载中…</p>}
        {error && (
          <p className="text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700">{error}</p>
        )}
        {node && !loading && (
          <div className="space-y-5">
            {node.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {node.tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {(node.keywords_zh.length > 0 || node.keywords_en.length > 0) && (
              <section>
                <SectionTitle>关键词</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {[...node.keywords_zh, ...node.keywords_en].map((keyword) => (
                    <span key={keyword} className="text-[10px] px-2 py-0.5 rounded-full bg-ink-100 text-ink-600">
                      {keyword}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {node.overview && (
              <section>
                <SectionTitle>摘要</SectionTitle>
                <WikiMarkdown content={node.overview} {...markdownProps} />
              </section>
            )}

            {node.body && (
              <section>
                <SectionTitle>正文</SectionTitle>
                <WikiMarkdown content={node.body} {...markdownProps} />
              </section>
            )}

            {bodySections.map(([sectionKey, sectionBody]) => (
              <section key={sectionKey}>
                <SectionTitle>{sectionKey}</SectionTitle>
                <WikiMarkdown content={sectionBody} {...markdownProps} />
              </section>
            ))}

            {node.references && (
              <section>
                <SectionTitle>引用</SectionTitle>
                <WikiMarkdown content={node.references} {...markdownProps} />
              </section>
            )}

            {connectionsMarkdown && (
              <section>
                <SectionTitle>链接</SectionTitle>
                <WikiMarkdown content={connectionsMarkdown} {...markdownProps} />
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
