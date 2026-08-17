import { useState } from "react";
import { APP_NAME } from "../constants/brand";
import { useChatSession } from "../context/ChatSessionContext";
import MessageList from "../components/chat/MessageList";
import ChatInput from "../components/ChatInput";
import SessionFilesDrawer from "../components/chat/SessionFilesDrawer";

export default function ChatPage() {
  const [filesOpen, setFilesOpen] = useState(false);
  const {
    messages, isLoading, error, skills,
    selectedSkillRef, setSelectedSkillRef,
    send, interrupt, currentSessionId, appendUploadedFile,
  } = useChatSession();

  return (
    <div className="flex flex-col h-full relative bg-[var(--app-surface)]">
      <header className="shrink-0 flex items-center justify-end gap-1 px-4 py-2.5 border-b border-ink-200/40">
        <button
          type="button"
          onClick={() => setFilesOpen(true)}
          className="group relative flex items-center justify-center w-10 h-10 rounded-xl text-ink-500 hover:text-ink-800 hover:bg-ink-200/40 transition-all"
          aria-label="会话文件"
          title="虚拟文件系统"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V6A2.25 2.25 0 014.5 3.75h4.379a2.25 2.25 0 011.59.659l2.122 2.122a2.25 2.25 0 001.59.659H19.5A2.25 2.25 0 0121.75 9v10.5A2.25 2.25 0 0119.5 21.75h-15a2.25 2.25 0 01-2.25-2.25z" />
          </svg>
          <span className="nav-tooltip">文件</span>
        </button>
      </header>

      {isLoading && (
        <div className="shrink-0 py-2 border-b border-ink-200/40">
          <p className="page-content text-xs text-brand-600 font-medium flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            {APP_NAME} 正在执行…
          </p>
        </div>
      )}

      {error && (
        <div className="shrink-0 py-2 border-b border-rose-100/80">
          <p className="page-content text-xs text-rose-600">{error}</p>
        </div>
      )}

      <MessageList messages={messages} sessionId={currentSessionId} />

      <div className="shrink-0 border-t border-ink-200/40 py-4">
        <div className="page-content">
          <ChatInput
            skills={skills}
            selectedSkillRef={selectedSkillRef}
            onSelectSkill={setSelectedSkillRef}
            onClearSkill={() => setSelectedSkillRef("")}
            isLoading={isLoading}
            onSend={send}
            onInterrupt={interrupt}
            sessionId={currentSessionId}
            onUploaded={appendUploadedFile}
          />
        </div>
      </div>

      <SessionFilesDrawer
        open={filesOpen}
        onClose={() => setFilesOpen(false)}
        sessionId={currentSessionId}
      />
    </div>
  );
}
