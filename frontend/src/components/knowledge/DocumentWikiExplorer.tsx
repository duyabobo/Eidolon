import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  knowledgeApi,
  KnowledgeDocument,
  WikiDocumentGraph,
  WikiGraphNode,
  WikiNodeItem,
} from "../../api/knowledge";
import WikiGraphView from "./WikiGraphView";
import WikiNodeDetail, { buildNodeReferenceLinks } from "./WikiNodeDetail";
import {
  collectReferenceHighlightIds,
  resolveNavigationTarget,
} from "./wikiConnections";

interface DocumentWikiExplorerProps {
  kbId: string;
  doc: KnowledgeDocument;
  onBack: () => void;
  backLabel?: string;
  hideBack?: boolean;
}

export default function DocumentWikiExplorer({
  kbId,
  doc,
  onBack,
  backLabel = "← 返回文档列表",
  hideBack = false,
}: DocumentWikiExplorerProps) {
  const [graph, setGraph] = useState<WikiDocumentGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeDetail, setNodeDetail] = useState<WikiNodeItem | null>(null);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [nodeError, setNodeError] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const loadGraph = useCallback(() => {
    setGraphLoading(true);
    setGraphError(null);
    knowledgeApi.getWikiGraphByDoc(doc.id, [kbId])
      .then(setGraph)
      .catch((e) => {
        setGraph(null);
        setGraphError(e instanceof Error ? e.message : "加载知识图谱失败");
      })
      .finally(() => setGraphLoading(false));
  }, [doc.id, kbId]);

  useEffect(() => {
    loadGraph();
    setSelectedNodeId(null);
    setNodeDetail(null);
    setNodeError(null);
  }, [loadGraph]);

  const referenceLinks = useMemo(() => {
    if (!nodeDetail || !graph) return [];
    return buildNodeReferenceLinks(nodeDetail, graph.nodes);
  }, [nodeDetail, graph]);

  const highlightNodeIds = useMemo(
    () => collectReferenceHighlightIds(selectedNodeId, referenceLinks),
    [selectedNodeId, referenceLinks],
  );

  const loadNodeDetail = useCallback(async (target: string) => {
    const graphNodes = graph?.nodes ?? [];
    const nodeId = resolveNavigationTarget(target, graphNodes);
    if (!nodeId) {
      setSelectedNodeId(null);
      setNodeDetail(null);
      setNodeError(`未找到节点：${target}`);
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    setSelectedNodeId(nodeId);
    setNodeLoading(true);
    setNodeError(null);
    setNodeDetail(null);
    try {
      const res = await knowledgeApi.getWikiNodeDetail(nodeId, [kbId], doc.id);
      setNodeDetail(res.node);
    } catch (e) {
      setNodeError(e instanceof Error ? e.message : "加载节点详情失败");
    } finally {
      setNodeLoading(false);
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [graph?.nodes, kbId, doc.id]);

  const handleNodeClick = async (node: WikiGraphNode) => {
    await loadNodeDetail(node.node_id);
  };

  return (
    <div className="space-y-4">
      {!hideBack && (
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-brand-600 hover:text-brand-700"
        >
          {backLabel}
        </button>
      )}

      <div>
        <h3 className="text-sm font-semibold text-ink-900">{doc.name}</h3>
        <p className="text-xs text-ink-400 mt-0.5">doc_id: {doc.id}</p>
      </div>

      {graphLoading ? (
        <p className="text-sm text-ink-400">加载知识图谱…</p>
      ) : graphError ? (
        <p className="text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700">{graphError}</p>
      ) : graph ? (
        <WikiGraphView
          graph={graph}
          selectedNodeId={selectedNodeId}
          highlightNodeIds={highlightNodeIds}
          onNodeClick={handleNodeClick}
        />
      ) : null}

      <div ref={detailRef}>
        <WikiNodeDetail
          node={nodeDetail}
          loading={nodeLoading}
          error={nodeError}
          graphNodes={graph?.nodes ?? []}
          referenceLinks={referenceLinks}
          onNavigateNode={loadNodeDetail}
          onClose={() => {
            setSelectedNodeId(null);
            setNodeDetail(null);
            setNodeError(null);
          }}
        />
      </div>
    </div>
  );
}
