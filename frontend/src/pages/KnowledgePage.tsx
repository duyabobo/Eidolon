import { useParams } from "react-router-dom";
import KnowledgePanel from "../components/KnowledgePanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";
import { useChatSession } from "../context/ChatSessionContext";

export default function KnowledgePage() {
  const { kbId, docId } = useParams<{ kbId?: string; docId?: string }>();
  const { userId } = useChatSession();

  return (
    <ManagePageLayout title="知识">
      <KnowledgePanel userId={userId} deepLinkKbId={kbId} deepLinkDocId={docId} />
    </ManagePageLayout>
  );
}
