import { useState, useEffect, useMemo } from "react";
import type { Message } from "../../context/ChatSessionContext";

interface AssistantTurn {
  steps: Message[];
  finalText: Message | null;
}

type DisplayItem =
  | { kind: "user"; content: string }
  | { kind: "assistant"; turn: AssistantTurn };

/** 按用户消息切分，每轮助手回复拆成「中间步骤 + 最终输出」 */
function groupMessages(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === "user") {
      items.push({ kind: "user", content: msg.content });
      i += 1;
      continue;
    }

    const assistantMsgs: Message[] = [];
    while (i < messages.length && messages[i].role === "assistant") {
      assistantMsgs.push(messages[i]);
      i += 1;
    }

    let lastTextIdx = -1;
    for (let j = assistantMsgs.length - 1; j >= 0; j -= 1) {
      if (assistantMsgs[j].type === "text") {
        lastTextIdx = j;
        break;
      }
    }

    const steps = lastTextIdx >= 0 ? assistantMsgs.slice(0, lastTextIdx) : assistantMsgs;
    const finalText = lastTextIdx >= 0 ? assistantMsgs[lastTextIdx] : null;
    items.push({ kind: "assistant", turn: { steps, finalText } });
  }

  return items;
}

function StepSummary({ steps }: { steps: Message[] }) {
  const parts: string[] = [];
  for (const s of steps) {
    if (s.type === "thinking") parts.push("思考");
    else if (s.type === "tool_call") {
      try {
        const p = JSON.parse(s.content) as { name: string };
        parts.push(p.name || "工具");
      } catch {
        parts.push("工具");
      }
    } else if (s.type === "tool_result") parts.push("结果");
    else if (s.type === "text") parts.push("输出");
  }
  const preview = parts.slice(0, 4).join(" → ");
  const extra = parts.length > 4 ? ` 等 ${parts.length} 步` : "";
  return <span className="truncate">{preview}{extra}</span>;
}

function StepContent({ msg }: { msg: Message }) {
  if (msg.type === "thinking") {
    return (
      <div className="text-xs">
        <p className="text-amber-600/80 font-medium mb-1 flex items-center gap-1.5">
          思考
          {msg.isStreaming && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
        </p>
        <div className="bg-amber-50/60 border border-amber-100 rounded-xl px-3 py-2 text-ink-500 italic whitespace-pre-wrap break-words leading-relaxed">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.type === "tool_call") {
    let name = "";
    let inputText = "";
    try {
      const p = JSON.parse(msg.content) as { name: string; input: unknown };
      name = p.name;
      inputText = JSON.stringify(p.input, null, 2);
    } catch {
      inputText = msg.content;
    }
    return (
      <div className="text-xs">
        <p className="text-brand-600 font-mono font-medium mb-1">{name || "工具调用"}</p>
        <pre className="bg-brand-50/50 border border-brand-100 rounded-xl px-3 py-2 text-ink-600 overflow-x-auto">{inputText}</pre>
      </div>
    );
  }

  if (msg.type === "tool_result") {
    let name = "";
    let outputText = "";
    let isError = false;
    try {
      const p = JSON.parse(msg.content) as { name: string; output: string; isError?: boolean };
      name = p.name;
      outputText = p.output;
      isError = !!p.isError;
    } catch {
      outputText = msg.content;
    }
    return (
      <div className="text-xs">
        <p className={`font-mono font-medium mb-1 ${isError ? "text-rose-500" : "text-emerald-600"}`}>
          {name ? `${name} 结果` : "执行结果"}
        </p>
        <pre className={`border rounded-xl px-3 py-2 overflow-x-auto max-h-48 ${
          isError ? "bg-rose-50/60 border-rose-100 text-rose-600" : "bg-emerald-50/60 border-emerald-100 text-ink-600"
        }`}>
          {outputText}
        </pre>
      </div>
    );
  }

  return (
    <div className="text-xs">
      <p className="text-ink-400 font-medium mb-1">中间输出</p>
      <div className="bg-ink-50 border border-ink-100 rounded-xl px-3 py-2 text-ink-600 whitespace-pre-wrap break-words leading-relaxed">
        {msg.content}
      </div>
    </div>
  );
}

function StepsPanel({ steps }: { steps: Message[] }) {
  const isActive = steps.some((s) => s.isStreaming);
  const [open, setOpen] = useState(isActive);

  useEffect(() => {
    if (isActive) setOpen(true);
    else setOpen(false);
  }, [isActive]);

  if (steps.length === 0) return null;

  return (
    <div className="max-w-[85%] mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left text-xs text-ink-400 hover:text-ink-600 transition-colors py-1"
      >
        <svg className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium shrink-0">
          {isActive ? "执行中" : "执行过程"}
          <span className="text-ink-300 font-normal ml-1">({steps.length})</span>
        </span>
        {!open && (
          <span className="text-ink-300 truncate min-w-0">
            <StepSummary steps={steps} />
          </span>
        )}
        {isActive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse shrink-0" />}
      </button>
      {open && (
        <div className="mt-1 ml-5 space-y-3 border-l-2 border-ink-100 pl-3">
          {steps.map((s, idx) => (
            <StepContent key={idx} msg={s} />
          ))}
        </div>
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

function AssistantTurnBlock({ turn }: { turn: AssistantTurn }) {
  const { steps, finalText } = turn;
  const hasSteps = steps.length > 0;
  const onlySteps = hasSteps && !finalText;

  return (
    <div className="flex gap-3 justify-start">
      <PiAvatar />
      <div className="flex-1 min-w-0">
        {hasSteps && <StepsPanel steps={steps} />}
        {finalText && (
          <div className="max-w-[85%] rounded-2.5xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-white/90 backdrop-blur-sm border border-ink-200/60 text-ink-900 shadow-soft">
            {finalText.content}
            {finalText.isStreaming && (
              <span className="inline-block w-0.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle rounded-full" />
            )}
          </div>
        )}
        {onlySteps && (
          <p className="text-xs text-ink-400 mt-1 italic">等待最终回复…</p>
        )}
      </div>
    </div>
  );
}

interface Props {
  messages: Message[];
  bottomRef: React.RefObject<HTMLDivElement>;
}

export default function MessageList({ messages, bottomRef }: Props) {
  const displayItems = useMemo(() => groupMessages(messages), [messages]);

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
        {displayItems.map((item, i) => {
          if (item.kind === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[78%] rounded-2.5xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft">
                  {item.content}
                </div>
              </div>
            );
          }
          return <AssistantTurnBlock key={i} turn={item.turn} />;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
