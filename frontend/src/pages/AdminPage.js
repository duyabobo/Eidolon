import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import LlmConfigPanel from "../components/LlmConfigPanel";
import McpConfigPanel from "../components/McpConfigPanel";
import SkillsPanel from "../components/SkillsPanel";
import KnowledgePanel from "../components/KnowledgePanel";
import { useChatSession } from "../context/ChatSessionContext";
const TAB_LABELS = {
    llm: "LLM",
    mcp: "MCP",
    skills: "Skill",
    knowledge: "Knowledge",
};
const TAB_IDS = Object.keys(TAB_LABELS);
function parseTab(value) {
    return TAB_IDS.includes(value) ? value : null;
}
export default function AdminPage() {
    const { kbId, docId } = useParams();
    const [searchParams] = useSearchParams();
    const tabFromQuery = parseTab(searchParams.get("tab"));
    const [tab, setTab] = useState(kbId && docId ? "knowledge" : tabFromQuery ?? "llm");
    const { userId, loadSkills } = useChatSession();
    useEffect(() => {
        if (kbId && docId) {
            setTab("knowledge");
        }
    }, [kbId, docId]);
    return (_jsx("div", { className: "h-full overflow-y-auto scrollbar-thin", children: _jsxs("div", { className: "page-content py-8", children: [_jsx("h1", { className: "text-xl font-semibold text-ink-900 mb-6 tracking-tight", children: "\u7BA1\u7406" }), _jsx("div", { className: "flex flex-wrap gap-1 p-1 rounded-xl bg-ink-100/70 w-fit mb-8", children: TAB_IDS.map((t) => (_jsx("button", { type: "button", onClick: () => setTab(t), className: `px-3.5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${tab === t
                            ? "bg-white text-brand-700 shadow-sm"
                            : "text-ink-500 hover:text-ink-700"}`, children: TAB_LABELS[t] }, t))) }), _jsxs("div", { className: "bg-white/80 backdrop-blur-sm rounded-2xl border border-ink-200/60 shadow-soft p-6", children: [tab === "llm" && _jsx(LlmConfigPanel, {}), tab === "mcp" && _jsx(McpConfigPanel, { userId: userId }), tab === "skills" && _jsx(SkillsPanel, { userId: userId, onSkillsChanged: loadSkills }), tab === "knowledge" && (_jsx(KnowledgePanel, { userId: userId, deepLinkKbId: kbId, deepLinkDocId: docId }))] })] }) }));
}
