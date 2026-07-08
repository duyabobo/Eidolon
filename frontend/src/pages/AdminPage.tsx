import { useState } from "react";
import LlmConfigPanel from "../components/LlmConfigPanel";
import McpConfigPanel from "../components/McpConfigPanel";
import SkillsPanel from "../components/SkillsPanel";

type Tab = "llm" | "mcp" | "skills";

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("llm");

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      <h1 className="text-xl font-semibold text-ink-900 mb-6 tracking-tight">系统配置</h1>

      <div className="flex gap-1 p-1 rounded-xl bg-ink-100/70 w-fit mb-8">
        {(["llm", "mcp", "skills"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
              tab === t
                ? "bg-white text-brand-700 shadow-sm"
                : "text-ink-500 hover:text-ink-700"
            }`}
          >
            {t === "llm" ? "LLM Provider" : t === "mcp" ? "MCP Servers" : "Skills"}
          </button>
        ))}
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-ink-200/60 shadow-soft p-6">
        {tab === "llm" && <LlmConfigPanel />}
        {tab === "mcp" && <McpConfigPanel />}
        {tab === "skills" && <SkillsPanel />}
      </div>
    </div>
  );
}
