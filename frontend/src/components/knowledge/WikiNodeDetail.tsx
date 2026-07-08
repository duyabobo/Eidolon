import ReactMarkdown from "react-markdown";
import type { WikiNodeItem } from "../../api/knowledge";

interface WikiNodeDetailProps {
  node: WikiNodeItem | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

export default function WikiNodeDetail({ node, loading, error, onClose }: WikiNodeDetailProps) {
  if (!node && !loading && !error) return null;

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
          <div className="space-y-4">
            {node.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {node.tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {node.overview && (
              <section>
                <h4 className="text-xs font-medium text-ink-500 mb-1">摘要</h4>
                <p className="text-sm text-ink-700 leading-relaxed">{node.overview}</p>
              </section>
            )}
            {node.body && (
              <section className="wiki-md prose prose-sm max-w-none text-ink-800">
                <ReactMarkdown>{node.body}</ReactMarkdown>
              </section>
            )}
            {node.references && (
              <section>
                <h4 className="text-xs font-medium text-ink-500 mb-1">引用</h4>
                <p className="text-xs text-ink-600 leading-relaxed whitespace-pre-wrap">{node.references}</p>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
