import SkillsPanel from "../components/SkillsPanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";
import { useChatSession } from "../context/ChatSessionContext";

export default function SkillsPage() {
  const { userId, loadSkills } = useChatSession();
  return (
    <ManagePageLayout title="技能">
      <SkillsPanel userId={userId} onSkillsChanged={loadSkills} />
    </ManagePageLayout>
  );
}
