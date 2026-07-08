import { useState, useEffect } from "react";
import type { Message } from "../../context/ChatSessionContext";

function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [open, setOpen] = useState(!!isStreaming);
  useEffect(() => { if (isStreaming) setOpen(true); }, [isStreaming]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!isStreaming) setOpen(false); }, [isStreaming]);
  return (
    <div className="max-w-[85%] text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-ink-400 hover:text-amber-600 transition-colors mb-1.5">
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <span className="italic font-medium">{isStreaming ? "正在思考…" : "思考过程"}</span>
        {isStreaming && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
      </button>
      {open && (
        <div className="bg-amber-50/80 border border-amber-200/70 rounded-2xl px-3.5 py-2.5 text-ink-500 italic whitespace-pre-wrap break-words leading-relaxed shadow-soft">
          {content}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(true);
  let name = ""; let inputText = "";
  try { const p = JSON.parse(content) as { name: string; input: unknown }; name = p.name; inputText = JSON.stringify(p.input, null, 2); }
  catch { inputText = content; }
  return (
    <div className="max-w-[85%] text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-brand-500 hover:text-brand-700 transition-colors mb-1.5">
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <span className="font-mono font-medium text-brand-600">{name || "工具调用"}</span>
      </button>
      {open && <pre className="bg-brand-50/60 border border-brand-100 rounded-2xl px-3.5 py-2.5 text-ink-600 overflow-x-auto shadow-soft">{inputText}</pre>}
    </div>
  );
}

function ToolResultBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  let name = ""; let outputText = ""; let isError = false;
  try { const p = JSON.parse(content) as { name: string; output: string; isError?: boolean }; name = p.name; outputText = p.output; isError = !!p.isError; }
  catch { outputText = content; }
  return (
    <div className="max-w-[85%] text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`flex items-center gap-1.5 transition-colors mb-1.5 ${isError ? "text-rose-400 hover:text-rose-600" : "text-emerald-500 hover:text-emerald-700"}`}>
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <span className={`font-mono font-medium ${isError ? "text-rose-500" : "text-emerald-600"}`}>{name ? `${name} 结果` : "执行结果"}</span>
      </button>
      {open && (
        <pre className={`border rounded-2xl px-3.5 py-2.5 overflow-x-auto shadow-soft ${isError ? "bg-rose-50/80 border-rose-100 text-rose-600" : "bg-emerald-50/80 border-emerald-100 text-ink-600"}`}>
          {outputText}
        </pre>
      )}
    </div>
  );
}

function PiAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-xs font-semibold shrink-0 mt-0.5 shadow-sm">
      π
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-2.5xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft">
          {msg.content}
        </div>
      </div>
    );
  }
  if (msg.type === "thinking") {
    return (
      <div className="flex gap-3 justify-start">
        <PiAvatar />
        <ThinkingBlock content={msg.content} isStreaming={msg.isStreaming} />
      </div>
    );
  }
  if (msg.type === "tool_call") {
    return (
      <div className="flex gap-3 justify-start">
        <PiAvatar />
        <ToolCallBlock content={msg.content} />
      </div>
    );
  }
  if (msg.type === "tool_result") {
    return (
      <div className="flex gap-3 justify-start">
        <PiAvatar />
        <ToolResultBlock content={msg.content} />
      </div>
    );
  }
  return (
    <div className="flex gap-3 justify-start">
      <PiAvatar />
      <div className="max-w-[78%] rounded-2.5xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-white/90 backdrop-blur-sm border border-ink-200/60 text-ink-900 shadow-soft">
        {msg.content}
        {msg.isStreaming && <span className="inline-block w-0.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle rounded-full" />}
      </div>
    </div>
  );
}

interface Props {
  messages: Message[];
  bottomRef: React.RefObject<HTMLDivElement>;
}

export default function MessageList({ messages, bottomRef }: Props) {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto w-full px-5 py-6 space-y-5">
        {messages.length === 0 && (
          <div className="text-center mt-24 px-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-2xl font-bold shadow-soft mb-4">
              π
            </div>
            <p className="text-ink-700 font-medium">开始与 Pi Agent 对话</p>
            <p className="text-sm text-ink-400 mt-2 leading-relaxed">
              输入 / 可选择 Skill，Enter 发送
            </p>
          </div>
        )}
        {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
