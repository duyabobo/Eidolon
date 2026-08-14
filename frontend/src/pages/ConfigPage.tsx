import { useEffect, useState } from "react";
import LlmConfigPanel from "../components/LlmConfigPanel";
import PipelineConfigPanel from "../components/PipelineConfigPanel";
import UserMemoryPanel from "../components/UserMemoryPanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";
import { ConfigPrimaryBtn } from "../components/config/ConfigActionBtn";
import { DEFAULT_USER_ID } from "../constants/user";
import { useChatSession } from "../context/ChatSessionContext";

type ConfigTab = "llm" | "pipeline" | "user";

const TABS: { id: ConfigTab; label: string }[] = [
  { id: "llm", label: "大模型" },
  { id: "pipeline", label: "小模型" },
  { id: "user", label: "用户" },
];

function UserIdConfigSection() {
  const { userId, setUserId, startNewChat, loadSessions } = useChatSession();
  const [draftId, setDraftId] = useState(userId);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraftId(userId);
  }, [userId]);

  const handleSave = () => {
    const next = draftId.trim() || DEFAULT_USER_ID;
    if (next !== userId.trim()) startNewChat();
    setUserId(next);
    setDraftId(next);
    loadSessions();
    setOkMsg("已保存");
  };

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-[11px] text-ink-500">用户 ID</span>
        <div className="flex items-center gap-2 max-w-lg">
          <input
            value={draftId}
            onChange={(e) => {
              setOkMsg(null);
              setDraftId(e.target.value);
            }}
            placeholder={DEFAULT_USER_ID}
            className="ui-field min-w-0 flex-1 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
          />
          <ConfigPrimaryBtn className="shrink-0" onClick={handleSave}>保存</ConfigPrimaryBtn>
          <UserMemoryPanel />
        </div>
      </label>
      {okMsg && (
        <p className="text-sm px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 max-w-lg">
          {okMsg}
        </p>
      )}
    </div>
  );
}

export default function ConfigPage() {
  const [tab, setTab] = useState<ConfigTab>("llm");
  /** 递增后通知 LlmConfigPanel 打开「添加」弹窗（与经验/工具右上角添加一致） */
  const [llmCreateRequestId, setLlmCreateRequestId] = useState(0);

  return (
    <ManagePageLayout title="配置">
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 border-b border-ink-100 -mt-1">
          <div className="flex gap-1 min-w-0">
            {TABS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`relative px-3.5 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "text-ink-900"
                      : "text-ink-400 hover:text-ink-600"
                  }`}
                >
                  {item.label}
                  {active && (
                    <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink-800" />
                  )}
                </button>
              );
            })}
          </div>
          {tab === "llm" && (
            <ConfigPrimaryBtn
              className="shrink-0 mb-1"
              onClick={() => setLlmCreateRequestId((n) => n + 1)}
            >
              添加
            </ConfigPrimaryBtn>
          )}
        </div>

        {tab === "llm" && (
          <LlmConfigPanel hideToolbarAdd createRequestId={llmCreateRequestId} />
        )}
        {tab === "pipeline" && <PipelineConfigPanel />}
        {tab === "user" && <UserIdConfigSection />}
      </div>
    </ManagePageLayout>
  );
}
