import { useCallback, useEffect, useState } from "react";
import { knowledgeApi, type WikiNodeItem } from "../../api/knowledge";
import { setKnowledgeSceneUid } from "../../api/knowledgeKeyCache";
import { useChatSession } from "../../context/ChatSessionContext";
import WikiNodeDetail from "../knowledge/WikiNodeDetail";

interface ChatWikiNodeModalProps {
  nodeId: string;
  onClose: () => void;
}

export default function ChatWikiNodeModal({ nodeId, onClose }: ChatWikiNodeModalProps) {
  const { userId } = useChatSession();
  const [node, setNode] = useState<WikiNodeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setKnowledgeSceneUid(userId);
  }, [userId]);

  const loadNode = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    setNode(null);
    try {
      const res = await knowledgeApi.getWikiNodeDetail(target.trim());
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/30 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="参考来源"
      >
        <WikiNodeDetail
          node={node}
          loading={loading}
          error={error}
          graphNodes={[]}
          onNavigateNode={loadNode}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
