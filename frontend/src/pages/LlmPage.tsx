import LlmConfigPanel from "../components/LlmConfigPanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";

export default function LlmPage() {
  return (
    <ManagePageLayout title="模型">
      <LlmConfigPanel />
    </ManagePageLayout>
  );
}
