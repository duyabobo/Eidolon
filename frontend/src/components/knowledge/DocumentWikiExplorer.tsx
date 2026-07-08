import { useCallback, useEffect, useState } from "react";
import {
  knowledgeApi,
  KnowledgeDocument,
  WikiDocumentGraph,
  WikiGraphNode,
  WikiNodeItem,
} from "../../api/knowledge";
import WikiGraphView from "./WikiGraphView";
import WikiNodeDetail from "./WikiNodeDetail";

interface DocumentWikiExplorerProps {
  kbId: string;
  doc: KnowledgeDocument;
  onBack: () => void;
}

export default function DocumentWikiExplorer({ kbId, doc, onBack }: DocumentWikiExplorerProps) {
  const [graph, setGraph] = useState<WikiDocumentGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeDetail, setNodeDetail] = useState<WikiNodeItem | null>(null);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [nodeError, setNodeError] = useState<string | null>(null);

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

  const handleNodeClick = async (node: WikiGraphNode) => {
    setSelectedNodeId(node.node_id);
    setNodeLoading(true);
    setNodeError(null);
    setNodeDetail(null);
    try {
      const res = await knowledgeApi.getWikiNodeDetail(node.node_id, [kbId]);
      setNodeDetail(res.node);
    } catch (e) {
      setNodeError(e instanceof Error ? e.message : "加载节点详情失败");
    } finally {
      setNodeLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-brand-600 hover:text-brand-700"
      >
        ← 返回文档列表
      </button>

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
          onNodeClick={handleNodeClick}
        />
      ) : null}

      <WikiNodeDetail
        node={nodeDetail}
        loading={nodeLoading}
        error={nodeError}
        onClose={() => {
          setSelectedNodeId(null);
          setNodeDetail(null);
          setNodeError(null);
        }}
      />
    </div>
  );
}
