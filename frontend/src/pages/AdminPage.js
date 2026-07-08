import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import LlmConfigPanel from "../components/LlmConfigPanel";
import McpConfigPanel from "../components/McpConfigPanel";
import SkillsPanel from "../components/SkillsPanel";
export default function AdminPage() {
    const [tab, setTab] = useState("llm");
    return (_jsxs("div", { className: "max-w-3xl mx-auto px-5 py-8", children: [_jsx("h1", { className: "text-xl font-semibold text-ink-900 mb-6 tracking-tight", children: "\u7CFB\u7EDF\u914D\u7F6E" }), _jsx("div", { className: "flex gap-1 p-1 rounded-xl bg-ink-100/70 w-fit mb-8", children: ["llm", "mcp", "skills"].map((t) => (_jsx("button", { onClick: () => setTab(t), className: `px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${tab === t
                        ? "bg-white text-brand-700 shadow-sm"
                        : "text-ink-500 hover:text-ink-700"}`, children: t === "llm" ? "LLM Provider" : t === "mcp" ? "MCP Servers" : "Skills" }, t))) }), _jsxs("div", { className: "bg-white/80 backdrop-blur-sm rounded-2xl border border-ink-200/60 shadow-soft p-6", children: [tab === "llm" && _jsx(LlmConfigPanel, {}), tab === "mcp" && _jsx(McpConfigPanel, {}), tab === "skills" && _jsx(SkillsPanel, {})] })] }));
}
