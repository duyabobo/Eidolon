import { useState } from "react";
import LlmConfigPanel from "../components/LlmConfigPanel";
import UserMemoryPanel from "../components/UserMemoryPanel";
import ManagePageLayout from "../components/layout/ManagePageLayout";
import { ConfigPrimaryBtn } from "../components/config/ConfigActionBtn";

type ConfigTab = "llm" | "user";

const TABS: { id: ConfigTab; label: string }[] = [
  { id: "llm", label: "大模型" },
  { id: "user", label: "用户记忆" },
];

export default function ConfigPage() {
  const [tab, setTab] = useState<ConfigTab>("llm");
  /** 递增后通知 LlmConfigPanel 打开「添加」弹窗（与经验/插件右上角添加一致） */
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
        {tab === "user" && <UserMemoryPanel />}
      </div>
    </ManagePageLayout>
  );
}
