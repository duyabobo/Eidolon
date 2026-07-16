import { jsx as _jsx } from "react/jsx-runtime";
import WorkspacePanel from "../components/WorkspacePanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";
import { useChatSession } from "../context/ChatSessionContext";
export default function WorkspacePage() {
    const { userId } = useChatSession();
    return (_jsx(ManagePageLayout, { title: "\u6587\u4EF6", children: _jsx(WorkspacePanel, { userId: userId }) }));
}
