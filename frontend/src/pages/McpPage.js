import { jsx as _jsx } from "react/jsx-runtime";
import McpConfigPanel from "../components/McpConfigPanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";
import { useChatSession } from "../context/ChatSessionContext";
export default function McpPage() {
    const { userId } = useChatSession();
    return (_jsx(ManagePageLayout, { title: "\u5DE5\u5177", children: _jsx(McpConfigPanel, { userId: userId }) }));
}
