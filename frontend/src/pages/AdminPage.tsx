import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import LlmConfigPanel from "../components/LlmConfigPanel";
import McpConfigPanel from "../components/McpConfigPanel";
import SkillsPanel from "../components/SkillsPanel";
import KnowledgePanel from "../components/KnowledgePanel";
import WorkspacePanel from "../components/WorkspacePanel";
import { useChatSession } from "../context/ChatSessionContext";

type Tab = "skills" | "knowledge" | "mcp" | "llm" | "workspace";

const TAB_LABELS: Record<Tab, string> = {
  skills: "Skill",
  knowledge: "Knowledge",
  mcp: "MCP",
  llm: "LLM",
  workspace: "Workspace",
};

const TAB_IDS = Object.keys(TAB_LABELS) as Tab[];

function parseTab(value: string | null): Tab | null {
  return TAB_IDS.includes(value as Tab) ? (value as Tab) : null;
}

export default function AdminPage() {
  const { kbId, docId } = useParams<{ kbId?: string; docId?: string }>();
  const [searchParams] = useSearchParams();
  const tabFromQuery = parseTab(searchParams.get("tab"));
  const [tab, setTab] = useState<Tab>(
    kbId ? "knowledge" : tabFromQuery ?? "skills",
  );
  const { userId, loadSkills } = useChatSession();

  useEffect(() => {
    if (kbId) {
      setTab("knowledge");
    }
  }, [kbId]);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="page-content py-8">
        <h1 className="text-xl font-semibold text-ink-900 mb-6 tracking-tight">管理</h1>

        <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-ink-100/70 w-fit mb-8">
          {TAB_IDS.map((t) => (
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
          {tab === "knowledge" && (
            <KnowledgePanel
              userId={userId}
              deepLinkKbId={kbId}
              deepLinkDocId={docId}
            />
          )}
          {tab === "workspace" && <WorkspacePanel userId={userId} />}
        </div>
      </div>
    </div>
  );
}
