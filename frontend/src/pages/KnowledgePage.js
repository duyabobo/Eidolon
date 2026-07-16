import { jsx as _jsx } from "react/jsx-runtime";
import { useParams } from "react-router-dom";
import KnowledgePanel from "../components/KnowledgePanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";
import { useChatSession } from "../context/ChatSessionContext";
export default function KnowledgePage() {
    const { kbId, docId } = useParams();
    const { userId } = useChatSession();
    return (_jsx(ManagePageLayout, { title: "\u77E5\u8BC6", children: _jsx(KnowledgePanel, { userId: userId, deepLinkKbId: kbId, deepLinkDocId: docId }) }));
}
