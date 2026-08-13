import { useCallback, useEffect, useState } from "react";
import { knowledgeApi, type WikiNodeItem } from "../../api/knowledge";
import WikiMarkdown from "../knowledge/WikiMarkdown";
import { buildWikiNodeMarkdown } from "../knowledge/wikiNodeContent";
import { resolveNodeTitle } from "../knowledge/WikiNodeMeta";

interface ChatWikiNodeModalProps {
  nodeId: string;
  onClose: () => void;
}

export default function ChatWikiNodeModal({ nodeId, onClose }: ChatWikiNodeModalProps) {
  const [activeNodeId, setActiveNodeId] = useState(nodeId);
  const [node, setNode] = useState<WikiNodeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNode = useCallback(async (target: string) => {
    const trimmed = target.trim();
    if (!trimmed) return;

    setActiveNodeId(trimmed);
    setLoading(true);
    setError(null);
    setNode(null);
    try {
      const res = await knowledgeApi.getWikiNodeDetail(trimmed);
      setNode(res.node);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载 Wiki 节点失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNode(nodeId);
  }, [nodeId, loadNode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const markdown = node ? buildWikiNodeMarkdown(node) : "";
  const title = node ? resolveNodeTitle(node) : "参考来源";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/30 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl shadow-panel w-full max-w-2xl border border-ink-200/60 max-h-[85vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-200/60 shrink-0">
          <div className="min-w-0">
            <h2 className="font-semibold text-ink-900 truncate">{loading ? "加载中…" : title}</h2>
            {node && (
              <p className="text-[11px] text-ink-400 mt-0.5 truncate">
                {node.type || "wiki"} · {activeNodeId.slice(0, 8)}…
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-2 py-1 border border-ink-200 rounded-lg text-ink-500 hover:bg-ink-50 shrink-0"
          >
            关闭
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto scrollbar-thin flex-1 min-h-0">
          {loading && <p className="text-sm text-ink-400">加载节点内容…</p>}
          {error && (
            <p className="text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700">{error}</p>
          )}
          {node && !loading && markdown && (
            <WikiMarkdown
              content={markdown}
              onWikiNodeClick={(target) => void loadNode(target)}
            />
          )}
          {node && !loading && !markdown && (
            <p className="text-sm text-ink-400">该节点暂无正文内容</p>
          )}
        </div>
      </div>
    </div>
  );
}
