import { useState } from "react";
import LlmConfigPanel from "../components/LlmConfigPanel";
import McpConfigPanel from "../components/McpConfigPanel";
import SkillsPanel from "../components/SkillsPanel";
import KnowledgePanel from "../components/KnowledgePanel";
import { useChatSession } from "../context/ChatSessionContext";

type Tab = "llm" | "mcp" | "skills" | "knowledge";

const TAB_LABELS: Record<Tab, string> = {
  llm: "LLM",
  mcp: "MCP",
  skills: "Skill",
  knowledge: "Knowledge",
};

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("llm");
  const { userId, loadSkills } = useChatSession();

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto px-5 py-8">
        <h1 className="text-xl font-semibold text-ink-900 mb-6 tracking-tight">管理</h1>

        <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-ink-100/70 w-fit mb-8">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3.5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                tab === t
                  ? "bg-white text-brand-700 shadow-sm"
                  : "text-ink-500 hover:text-ink-700"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-ink-200/60 shadow-soft p-6">
          {tab === "llm" && <LlmConfigPanel />}
          {tab === "mcp" && <McpConfigPanel userId={userId} />}
          {tab === "skills" && <SkillsPanel userId={userId} onSkillsChanged={loadSkills} />}
          {tab === "knowledge" && <KnowledgePanel />}
        </div>
      </div>
    </div>
  );
}
