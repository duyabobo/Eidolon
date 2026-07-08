import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import LlmConfigPanel from "../components/LlmConfigPanel";
import McpConfigPanel from "../components/McpConfigPanel";
import UserMcpPanel from "../components/UserMcpPanel";
import SkillsPanel from "../components/SkillsPanel";
import SkillCreatorChat from "../components/SkillCreatorChat";
import { useChatSession } from "../context/ChatSessionContext";
const TAB_LABELS = {
    llm: "LLM",
    mcp: "系统 MCP",
    "user-mcp": "个人 MCP",
    skills: "系统 Skill",
    "create-skill": "创建 Skill",
};
export default function AdminPage() {
    const [tab, setTab] = useState("llm");
    const { userId, loadSkills } = useChatSession();
    const [showCreator, setShowCreator] = useState(false);
    return (_jsx("div", { className: "h-full overflow-y-auto scrollbar-thin", children: _jsxs("div", { className: "max-w-3xl mx-auto px-5 py-8", children: [_jsx("h1", { className: "text-xl font-semibold text-ink-900 mb-6 tracking-tight", children: "\u7BA1\u7406" }), _jsx("div", { className: "flex flex-wrap gap-1 p-1 rounded-xl bg-ink-100/70 w-fit mb-8", children: Object.keys(TAB_LABELS).map((t) => (_jsx("button", { type: "button", onClick: () => setTab(t), className: `px-3.5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${tab === t
                            ? "bg-white text-brand-700 shadow-sm"
                            : "text-ink-500 hover:text-ink-700"}`, children: TAB_LABELS[t] }, t))) }), _jsxs("div", { className: "bg-white/80 backdrop-blur-sm rounded-2xl border border-ink-200/60 shadow-soft p-6", children: [tab === "llm" && _jsx(LlmConfigPanel, {}), tab === "mcp" && _jsx(McpConfigPanel, {}), tab === "user-mcp" && (userId.trim() ? (_jsx(UserMcpPanel, { userId: userId.trim(), embedded: true })) : (_jsx("p", { className: "text-sm text-ink-400 text-center py-8", children: "\u8BF7\u5148\u5728\u300C\u5386\u53F2\u300D\u9875\u8BBE\u7F6E\u7528\u6237 ID\uFF0C\u518D\u914D\u7F6E\u4E2A\u4EBA MCP" }))), tab === "skills" && _jsx(SkillsPanel, {}), tab === "create-skill" && (_jsxs("div", { className: "space-y-4", children: [_jsx("p", { className: "text-sm text-ink-500", children: "\u901A\u8FC7 skill-creator \u5BF9\u8BDD\u521B\u5EFA\u4E2A\u4EBA Skill\uFF0C\u4FDD\u5B58\u540E\u53EF\u5728\u5BF9\u8BDD\u4E2D\u901A\u8FC7 / \u9009\u62E9\u4F7F\u7528\u3002" }), !userId.trim() ? (_jsx("p", { className: "text-sm text-ink-400 text-center py-8 border border-dashed border-ink-200 rounded-xl", children: "\u8BF7\u5148\u5728\u300C\u5386\u53F2\u300D\u9875\u8BBE\u7F6E\u7528\u6237 ID" })) : showCreator ? (_jsx(SkillCreatorChat, { userId: userId.trim(), scope: "user", embedded: true, onClose: () => setShowCreator(false), onPublished: () => {
                                        loadSkills();
                                        setShowCreator(false);
                                    } })) : (_jsx("button", { type: "button", onClick: () => setShowCreator(true), className: "ui-btn-primary w-full", children: "\u5F00\u59CB\u5BF9\u8BDD\u521B\u5EFA Skill" }))] }))] })] }) }));
}
