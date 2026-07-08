import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { knowledgeApi, } from "../../api/knowledge";
import WikiGraphView from "./WikiGraphView";
import WikiNodeDetail from "./WikiNodeDetail";
export default function DocumentWikiExplorer({ kbId, doc, onBack }) {
    const [graph, setGraph] = useState(null);
    const [graphLoading, setGraphLoading] = useState(true);
    const [graphError, setGraphError] = useState(null);
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const [nodeDetail, setNodeDetail] = useState(null);
    const [nodeLoading, setNodeLoading] = useState(false);
    const [nodeError, setNodeError] = useState(null);
    const detailRef = useRef(null);
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
    const loadNodeDetail = useCallback(async (nodeId) => {
        setSelectedNodeId(nodeId);
        setNodeLoading(true);
        setNodeError(null);
        setNodeDetail(null);
        try {
            const res = await knowledgeApi.getWikiNodeDetail(nodeId, [kbId]);
            setNodeDetail(res.node);
        }
        catch (e) {
            setNodeError(e instanceof Error ? e.message : "加载节点详情失败");
        }
        finally {
            setNodeLoading(false);
            detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }, [kbId]);
    const handleNodeClick = async (node) => {
        await loadNodeDetail(node.node_id);
    };
    return (_jsxs("div", { className: "space-y-4", children: [_jsx("button", { type: "button", onClick: onBack, className: "text-sm text-brand-600 hover:text-brand-700", children: "\u2190 \u8FD4\u56DE\u6587\u6863\u5217\u8868" }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-semibold text-ink-900", children: doc.name }), _jsxs("p", { className: "text-xs text-ink-400 mt-0.5", children: ["doc_id: ", doc.id] })] }), graphLoading ? (_jsx("p", { className: "text-sm text-ink-400", children: "\u52A0\u8F7D\u77E5\u8BC6\u56FE\u8C31\u2026" })) : graphError ? (_jsx("p", { className: "text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700", children: graphError })) : graph ? (_jsx(WikiGraphView, { graph: graph, selectedNodeId: selectedNodeId, onNodeClick: handleNodeClick })) : null, _jsx("div", { ref: detailRef, children: _jsx(WikiNodeDetail, { node: nodeDetail, loading: nodeLoading, error: nodeError, graphNodes: graph?.nodes ?? [], graphEdges: graph?.edges ?? [], onNavigateNode: loadNodeDetail, onClose: () => {
                        setSelectedNodeId(null);
                        setNodeDetail(null);
                        setNodeError(null);
                    } }) })] }));
}
