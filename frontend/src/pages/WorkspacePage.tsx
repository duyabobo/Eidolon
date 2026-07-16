import WorkspacePanel from "../components/WorkspacePanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";
import { useChatSession } from "../context/ChatSessionContext";

export default function WorkspacePage() {
  const { userId } = useChatSession();
  return (
    <ManagePageLayout title="文件">
      <WorkspacePanel userId={userId} />
    </ManagePageLayout>
  );
}
