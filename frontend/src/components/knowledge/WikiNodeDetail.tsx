import type { WikiGraphEdge, WikiGraphNode, WikiNodeItem } from "../../api/knowledge";
import WikiConnectionList from "./WikiConnectionList";
import WikiMarkdown from "./WikiMarkdown";
import WikiNodeMeta, { resolveNodeTitle, resolveNodeType } from "./WikiNodeMeta";
import { resolveWikiConnections } from "./wikiConnections";

interface WikiNodeDetailProps {
  node: WikiNodeItem | null;
  loading: boolean;
  error: string | null;
  graphNodes: WikiGraphNode[];
  graphEdges?: WikiGraphEdge[];
  onNavigateNode: (target: string) => void;
  onClose: () => void;
}

function SectionTitle({ children }: { children: string }) {
  return <h4 className="text-xs font-medium text-ink-500 mb-1.5">{children}</h4>;
}

function collectReferenceInputs(node: WikiNodeItem): unknown[] {
  const inputs: unknown[] = [...(node.connections ?? [])];
  if (node.references?.trim()) {
    inputs.push(node.references);
  }
  return inputs;
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

  const overview = node?.overview?.trim() ?? "";
  const body = node?.body?.trim() ?? "";
  // 摘要与详情相同时只展示详情，避免旧数据/错误解析导致重复
  const showOverview = Boolean(overview) && overview !== body;
  const references = node?.references?.trim() ?? "";
  const referenceLinks = node
    ? resolveWikiConnections(collectReferenceInputs(node), graphNodes, graphEdges, node.node_id)
    : [];

  const markdownProps = {
    graphNodes,
    onWikiNodeClick: onNavigateNode,
  };

  return (
    <div className="border border-ink-200/60 rounded-xl overflow-hidden bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200/50 bg-ink-50/40">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900 truncate">
            {loading ? "加载节点…" : node ? resolveNodeTitle(node) : "节点详情"}
          </p>
          {node && (
            <p className="text-[11px] text-ink-400 mt-0.5">
              {resolveNodeType(node) || "wiki"} · {node.node_id.slice(0, 8)}…
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
            <WikiNodeMeta node={node} />

            {showOverview && (
              <section>
                <SectionTitle>摘要</SectionTitle>
                <WikiMarkdown content={overview} {...markdownProps} />
              </section>
            )}

            {body && (
              <section>
                <SectionTitle>详情</SectionTitle>
                <WikiMarkdown content={body} {...markdownProps} />
              </section>
            )}

            {(references || referenceLinks.length > 0) && (
              <section>
                <SectionTitle>引用</SectionTitle>
                {references && <WikiMarkdown content={references} {...markdownProps} />}
                {referenceLinks.length > 0 && (
                  <div className={references ? "mt-2" : undefined}>
                    <WikiConnectionList links={referenceLinks} onNavigate={onNavigateNode} />
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
