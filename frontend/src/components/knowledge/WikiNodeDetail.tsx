import type { WikiGraphEdge, WikiGraphNode, WikiNodeItem } from "../../api/knowledge";
import WikiConnectionList from "./WikiConnectionList";
import WikiInlineMarkdown from "./WikiInlineMarkdown";
import WikiMarkdown from "./WikiMarkdown";
import WikiNodeMeta, { resolveNodeTitle, resolveNodeType } from "./WikiNodeMeta";
import { resolveWikiConnections, type WikiConnectionLink } from "./wikiConnections";

interface WikiNodeDetailProps {
  node: WikiNodeItem | null;
  loading: boolean;
  error: string | null;
  graphNodes: WikiGraphNode[];
  graphEdges?: WikiGraphEdge[];
  referenceLinks?: WikiConnectionLink[];
  onNavigateNode: (target: string) => void;
  onClose: () => void;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h4 className="text-base font-bold text-ink-900 mb-2.5">
      {children}
    </h4>
  );
}

export function buildNodeReferenceLinks(
  node: WikiNodeItem,
  graphNodes: WikiGraphNode[],
): WikiConnectionLink[] {
  const inputs: unknown[] = [...(node.connections ?? [])];
  if (node.references?.trim()) {
    inputs.push(node.references);
  }
  return resolveWikiConnections(inputs, graphNodes, [], node.node_id, {
    includeGraphEdges: false,
    onlyResolved: true,
  });
}

export default function WikiNodeDetail({
  node,
  loading,
  error,
  graphNodes,
  referenceLinks: referenceLinksProp,
  onNavigateNode,
  onClose,
}: WikiNodeDetailProps) {
  if (!node && !loading && !error) return null;

  const overview = node?.overview?.trim() ?? "";
  const body = node?.body?.trim() ?? "";
  const showOverview = Boolean(overview) && overview !== body;
  const referenceLinks = referenceLinksProp
    ?? (node ? buildNodeReferenceLinks(node, graphNodes) : []);

  const markdownProps = {
    graphNodes,
    onWikiNodeClick: onNavigateNode,
  };

  return (
    <div className="border border-ink-200/60 rounded-xl overflow-hidden bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200/50 bg-ink-50/40">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900 truncate">
            {loading ? (
              "加载节点…"
            ) : node ? (
              <WikiInlineMarkdown content={resolveNodeTitle(node)} />
            ) : (
              "节点详情"
            )}
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

            {referenceLinks.length > 0 && (
              <section>
                <SectionTitle>引用</SectionTitle>
                <WikiConnectionList links={referenceLinks} onNavigate={onNavigateNode} />
              </section>
            )}

            {!showOverview && !body && referenceLinks.length === 0 && (
              <p className="text-sm text-ink-400">该节点暂无摘要与详情</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
