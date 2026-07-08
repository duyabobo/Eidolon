import { useRef, useEffect } from "react";
import { useChatSession } from "../context/ChatSessionContext";
import MessageList from "../components/chat/MessageList";
import ChatInput from "../components/ChatInput";

export default function ChatPage() {
  const {
    messages, isLoading, error, skills,
    selectedSkillRef, setSelectedSkillRef,
    send, interrupt,
  } = useChatSession();

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {isLoading && (
        <div className="shrink-0 py-2 border-b border-ink-100/80 bg-brand-50/50">
          <p className="page-content text-xs text-brand-600 font-medium flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Pi 正在执行…
          </p>
        </div>
      )}

      {error && (
        <div className="shrink-0 py-2 bg-rose-50 border-b border-rose-100">
          <p className="page-content text-xs text-rose-600">{error}</p>
        </div>
      )}

      <MessageList messages={messages} bottomRef={bottomRef} />

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
          />
        </div>
      </div>
    </div>
  );
}
