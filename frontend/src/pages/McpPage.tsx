import McpConfigPanel from "../components/McpConfigPanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";

export default function McpPage() {
  return (
    <ManagePageLayout title="工具">
      <McpConfigPanel />
    </ManagePageLayout>
  );
}
