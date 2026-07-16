import McpConfigPanel from "../components/McpConfigPanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";
import { useChatSession } from "../context/ChatSessionContext";

export default function McpPage() {
  const { userId } = useChatSession();
  return (
    <ManagePageLayout title="工具">
      <McpConfigPanel userId={userId} />
    </ManagePageLayout>
  );
}
