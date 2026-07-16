import { useState } from "react";
import { APP_NAME } from "../constants/brand";
import { useChatSession } from "../context/ChatSessionContext";
import MessageList from "../components/chat/MessageList";
import ChatInput from "../components/ChatInput";
import ChatHistoryDrawer from "../components/chat/ChatHistoryDrawer";

export default function ChatPage() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const {
    messages, isLoading, error, skills,
    selectedSkillRef, setSelectedSkillRef,
    send, interrupt, userId, currentSessionId, appendUploadedFile,
  } = useChatSession();

  return (
    <div className="flex flex-col h-full relative">
      <header className="shrink-0 flex items-center justify-end px-4 py-2.5 border-b border-ink-100/80 bg-white/60 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="group relative flex items-center justify-center w-10 h-10 rounded-xl text-ink-500 hover:text-brand-700 hover:bg-white hover:shadow-sm transition-all"
          aria-label="历史对话"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="nav-tooltip">历史</span>
        </button>
      </header>

      {isLoading && (
        <div className="shrink-0 py-2 border-b border-ink-100/80 bg-brand-50/50">
          <p className="page-content text-xs text-brand-600 font-medium flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            {APP_NAME} 正在执行…
          </p>
        </div>
      )}

      {error && (
        <div className="shrink-0 py-2 bg-rose-50 border-b border-rose-100">
          <p className="page-content text-xs text-rose-600">{error}</p>
        </div>
      )}

      <MessageList messages={messages} />

      <div className="shrink-0 border-t border-ink-200/60 bg-white/80 backdrop-blur-xl py-4">
        <div className="page-content">
          <ChatInput
            skills={skills}
            selectedSkillRef={selectedSkillRef}
            onSelectSkill={setSelectedSkillRef}
            onClearSkill={() => setSelectedSkillRef("")}
            isLoading={isLoading}
            onSend={send}
            onInterrupt={interrupt}
            userId={userId}
            sessionId={currentSessionId}
            onUploaded={appendUploadedFile}
          />
        </div>
      </div>

      <ChatHistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
