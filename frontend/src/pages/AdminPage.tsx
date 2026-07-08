import { useState } from "react";
import LlmConfigPanel from "../components/LlmConfigPanel";
import McpConfigPanel from "../components/McpConfigPanel";
import UserMcpPanel from "../components/UserMcpPanel";
import SkillsPanel from "../components/SkillsPanel";
import SkillCreatorChat from "../components/SkillCreatorChat";
import { useChatSession } from "../context/ChatSessionContext";

type Tab = "llm" | "mcp" | "user-mcp" | "skills" | "create-skill";

const TAB_LABELS: Record<Tab, string> = {
  llm: "LLM",
  mcp: "系统 MCP",
  "user-mcp": "个人 MCP",
  skills: "系统 Skill",
  "create-skill": "创建 Skill",
};

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("llm");
  const { userId, loadSkills } = useChatSession();
  const [showCreator, setShowCreator] = useState(false);

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
          {tab === "mcp" && <McpConfigPanel />}
          {tab === "user-mcp" && (
            userId.trim() ? (
              <UserMcpPanel userId={userId.trim()} embedded />
            ) : (
              <p className="text-sm text-ink-400 text-center py-8">
                请先在「历史」页设置用户 ID，再配置个人 MCP
              </p>
            )
          )}
          {tab === "skills" && <SkillsPanel />}
          {tab === "create-skill" && (
            <div className="space-y-4">
              <p className="text-sm text-ink-500">
                通过 skill-creator 对话创建个人 Skill，保存后可在对话中通过 / 选择使用。
              </p>
              {!userId.trim() ? (
                <p className="text-sm text-ink-400 text-center py-8 border border-dashed border-ink-200 rounded-xl">
                  请先在「历史」页设置用户 ID
                </p>
              ) : showCreator ? (
                <SkillCreatorChat
                  userId={userId.trim()}
                  scope="user"
                  embedded
                  onClose={() => setShowCreator(false)}
                  onPublished={() => {
                    loadSkills();
                    setShowCreator(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCreator(true)}
                  className="ui-btn-primary w-full"
                >
                  开始对话创建 Skill
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
