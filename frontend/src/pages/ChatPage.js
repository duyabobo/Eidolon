import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { APP_NAME } from "../constants/brand";
import { useChatSession } from "../context/ChatSessionContext";
import MessageList from "../components/chat/MessageList";
import ChatInput from "../components/ChatInput";
export default function ChatPage() {
    const { messages, isLoading, error, skills, selectedSkillRef, setSelectedSkillRef, send, interrupt, userId, currentSessionId, appendUploadedFile, } = useChatSession();
    return (_jsxs("div", { className: "flex flex-col h-full", children: [isLoading && (_jsx("div", { className: "shrink-0 py-2 border-b border-ink-100/80 bg-brand-50/50", children: _jsxs("p", { className: "page-content text-xs text-brand-600 font-medium flex items-center gap-1.5", children: [_jsx("span", { className: "inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" }), APP_NAME, " \u6B63\u5728\u6267\u884C\u2026"] }) })), error && (_jsx("div", { className: "shrink-0 py-2 bg-rose-50 border-b border-rose-100", children: _jsx("p", { className: "page-content text-xs text-rose-600", children: error }) })), _jsx(MessageList, { messages: messages }), _jsx("div", { className: "shrink-0 border-t border-ink-200/60 bg-white/80 backdrop-blur-xl py-4", children: _jsx("div", { className: "page-content", children: _jsx(ChatInput, { skills: skills, selectedSkillRef: selectedSkillRef, onSelectSkill: setSelectedSkillRef, onClearSkill: () => setSelectedSkillRef(""), isLoading: isLoading, onSend: send, onInterrupt: interrupt, userId: userId, sessionId: currentSessionId, onUploaded: appendUploadedFile }) }) })] }));
}
