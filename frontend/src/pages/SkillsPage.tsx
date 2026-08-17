import SkillsPanel from "../components/SkillsPanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";
import { useChatSession } from "../context/ChatSessionContext";

export default function SkillsPage() {
  const { loadSkills } = useChatSession();
  return (
    <ManagePageLayout title="经验">
      <SkillsPanel onSkillsChanged={loadSkills} />
    </ManagePageLayout>
  );
}
