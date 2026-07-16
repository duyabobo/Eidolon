import { jsx as _jsx } from "react/jsx-runtime";
import SkillsPanel from "../components/SkillsPanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";
import { useChatSession } from "../context/ChatSessionContext";
export default function SkillsPage() {
    const { userId, loadSkills } = useChatSession();
    return (_jsx(ManagePageLayout, { title: "\u6280\u80FD", children: _jsx(SkillsPanel, { userId: userId, onSkillsChanged: loadSkills }) }));
}
