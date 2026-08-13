import { useParams } from "react-router-dom";
import KnowledgePanel from "../components/KnowledgePanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";

export default function KnowledgePage() {
  const { kbId, docId } = useParams<{ kbId?: string; docId?: string }>();

  return (
    <ManagePageLayout title="知识">
      <KnowledgePanel deepLinkKbId={kbId} deepLinkDocId={docId} />
    </ManagePageLayout>
  );
}
