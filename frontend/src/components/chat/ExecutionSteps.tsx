import { useState, useEffect } from "react";
import type { Message } from "../../context/ChatSessionContext";
import {
  formatStepSeconds, messageDuration, toolStepDuration, isStepLive, stepGroupDuration,
} from "./stepTiming";

export type StepGroup =
  | { kind: "thinking"; msg: Message }
  | { kind: "tool"; call: Message; result?: Message }
  | { kind: "text"; msg: Message };

export function groupSteps(steps: Message[]): StepGroup[] {
  const groups: StepGroup[] = [];
  let i = 0;
  while (i < steps.length) {
    const s = steps[i];
    if (s.type === "thinking") {
      groups.push({ kind: "thinking", msg: s });
      i += 1;
    } else if (s.type === "tool_call") {
      const next = steps[i + 1];
      if (next?.type === "tool_result") {
        groups.push({ kind: "tool", call: s, result: next });
        i += 2;
      } else {
        groups.push({ kind: "tool", call: s });
        i += 1;
      }
    } else if (s.type === "tool_result") {
      groups.push({
        kind: "tool",
        call: { role: "assistant", type: "tool_call", content: "{}" },
        result: s,
      });
      i += 1;
    } else {
      groups.push({ kind: "text", msg: s });
      i += 1;
    }
  }
  return groups;
}

function parseToolCall(content: string): { name: string; input: unknown; inputText: string } {
  const raw = content ?? "";
  try {
    const p = JSON.parse(raw) as { name?: string; input?: unknown };
    const inputText = JSON.stringify(p.input ?? null, null, 2) ?? "null";
    return {
      name: p.name || "工具",
      input: p.input,
      inputText,
    };
  } catch {
    return { name: "工具", input: null, inputText: raw };
  }
}

function parseToolResult(content: string): { name: string; output: string; isError: boolean } {
  const raw = content ?? "";
  try {
    const p = JSON.parse(raw) as { name?: string; output?: string; isError?: boolean };
    return { name: p.name || "", output: p.output ?? "", isError: !!p.isError };
  } catch {
    return { name: "", output: raw, isError: false };
  }
}

/** 从 tool input 提取一行摘要 */
function toolInputPreview(input: unknown, inputText: string): string {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    if (typeof obj.command === "string") return obj.command;
    if (typeof obj.query === "string") return obj.query;
    if (typeof obj.path === "string") return obj.path;
    const first = Object.values(obj).find((v) => typeof v === "string");
    if (typeof first === "string") return first.length > 120 ? `${first.slice(0, 120)}…` : first;
  }
  const safe = inputText ?? "";
  const oneLine = safe.replace(/\s+/g, " ").trim();
  return oneLine.length > 100 ? `${oneLine.slice(0, 100)}…` : oneLine;
}

function outputPreview(text: string, maxLines = 3): { preview: string; truncated: boolean } {
  const safe = text ?? "";
  const lines = safe.split("\n");
  if (lines.length <= maxLines && safe.length <= 280) return { preview: safe, truncated: false };
  const clipped = lines.slice(0, maxLines).join("\n");
  const preview = clipped.length > 280 ? `${clipped.slice(0, 280)}…` : clipped;
  return { preview, truncated: true };
}

function useLiveClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      setNow(Date.now());
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function DurationBadge({ ms, live }: { ms: number | null; live?: boolean }) {
  const label = formatStepSeconds(ms);
  if (!label) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono tabular-nums shrink-0 ${
      live ? "bg-brand-50 text-brand-600 ring-1 ring-brand-200/60" : "bg-ink-100/90 text-ink-500"
    }`}>
      <svg className="w-2.5 h-2.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {label}
    </span>
  );
}

function CollapseBody({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-ink-400 hover:text-brand-600 transition-colors flex items-center gap-1"
      >
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {title}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function StepIcon({ kind, isError }: { kind: "thinking" | "tool" | "text"; isError?: boolean }) {
  const base = "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 shadow-sm";
  if (kind === "thinking") {
    return (
      <div className={`${base} bg-amber-100 text-amber-700`}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </div>
    );
  }
  if (kind === "tool") {
    return (
      <div className={`${base} ${isError ? "bg-rose-100 text-rose-600" : "bg-brand-100 text-brand-700"}`}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
    );
  }
  return (
    <div className={`${base} bg-ink-100 text-ink-500`}>
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
      </svg>
    </div>
  );
}

function ThinkingStep({ msg, index, now }: { msg: Message; index: number; now: number }) {
  const streaming = !!msg.isStreaming;
  const content = msg.content ?? "";
  const preview = content.length > 160 ? `${content.slice(0, 160)}…` : content;
  const durationMs = messageDuration(msg, now);
  const live = isStepLive(msg);

  return (
    <div className="step-timeline-item">
      <div className="step-timeline-node">{index}</div>
      <div className="step-timeline-line" />
      <div className="flex gap-3 flex-1 min-w-0 pb-4 step-timeline-body">
        <StepIcon kind="thinking" />
        <div className="flex-1 min-w-0 rounded-xl border border-amber-200/70 bg-gradient-to-br from-amber-50/90 to-orange-50/40 overflow-hidden">
          <div className="px-3 py-2 border-b border-amber-100/80 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-amber-800 tracking-wide">思考</span>
            <div className="flex items-center gap-2">
              <DurationBadge ms={durationMs} live={live} />
              {streaming && (
                <span className="text-[10px] text-amber-600 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  进行中
                </span>
              )}
            </div>
          </div>
          <div className="px-3 py-2.5 text-xs text-amber-900/70 italic leading-relaxed whitespace-pre-wrap break-words">
            {streaming ? content : preview}
          </div>
          {!streaming && content.length > 160 && (
            <CollapseBody title="查看完整思考">
              <div className="px-3 pb-2.5 text-xs text-amber-900/70 italic whitespace-pre-wrap break-words leading-relaxed">
                {content}
              </div>
            </CollapseBody>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolStep({ call, result, index, now }: { call: Message; result?: Message; index: number; now: number }) {
  const { name, input, inputText } = parseToolCall(call.content ?? "");
  const inputHighlight = toolInputPreview(input, inputText);
  const callStreaming = !!call.isStreaming;
  const durationMs = toolStepDuration(call, result, now);
  const live = isStepLive(call, ...(result ? [result] : []));

  let resultName = "";
  let outputText = "";
  let isError = false;
  let resultStreaming = false;
  if (result) {
    const parsed = parseToolResult(result.content ?? "");
    resultName = parsed.name;
    outputText = parsed.output;
    isError = parsed.isError;
    resultStreaming = !!result.isStreaming;
  }

  const { preview: outPreview, truncated: outTruncated } = outputPreview(outputText);
  const done = result && !resultStreaming && !callStreaming;

  return (
    <div className="step-timeline-item">
      <div className="step-timeline-node">{index}</div>
      <div className="step-timeline-line" />
      <div className="flex gap-3 flex-1 min-w-0 pb-4 step-timeline-body">
        <StepIcon kind="tool" isError={isError} />
        <div className={`flex-1 min-w-0 rounded-xl border overflow-hidden shadow-soft ${
          isError ? "border-rose-200/80 bg-white" : "border-brand-200/60 bg-white"
        }`}>
          <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-ink-100/80 bg-white/60">
            <code className="text-sm font-semibold text-brand-800 truncate">{name}</code>
            <div className="flex items-center gap-2 shrink-0">
              <DurationBadge ms={durationMs} live={live} />
              {(callStreaming || resultStreaming) && (
                <span className="text-[10px] text-brand-500 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
                  执行中
                </span>
              )}
            </div>
          </div>
          {/* 调用 */}
          <div className="px-3 py-2.5 bg-gradient-to-r from-brand-50/80 to-violet-50/40 border-b border-brand-100/60">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-brand-500 font-semibold">调用</span>
            </div>
            {inputHighlight && (
              <pre className="mt-2 text-xs font-mono text-ink-700 bg-white/70 border border-brand-100/80 rounded-lg px-2.5 py-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                {inputHighlight}
              </pre>
            )}
            <CollapseBody title="查看完整参数">
              <pre className="text-[11px] font-mono text-ink-600 bg-ink-50 rounded-lg px-2.5 py-2 overflow-x-auto">{inputText}</pre>
            </CollapseBody>
          </div>

          {/* 结果 */}
          {result ? (
            <div className={`px-3 py-2.5 ${isError ? "bg-rose-50/50" : "bg-emerald-50/30"}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${
                  isError ? "text-rose-600" : "text-emerald-600"
                }`}>
                  {isError ? (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                  )}
                  {isError ? "失败" : "成功"}
                </span>
                {resultName && resultName !== name && (
                  <code className="text-[11px] text-ink-400">{resultName}</code>
                )}
                {resultStreaming && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
              </div>
              <pre className={`text-xs font-mono leading-relaxed whitespace-pre-wrap break-words ${
                isError ? "text-rose-700" : "text-ink-700"
              }`}>
                {resultStreaming ? outputText : outPreview}
              </pre>
              {!resultStreaming && outTruncated && (
                <CollapseBody title="查看完整输出">
                  <pre className={`text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words max-h-64 overflow-y-auto scrollbar-thin ${
                    isError ? "text-rose-700" : "text-ink-600"
                  }`}>
                    {outputText}
                  </pre>
                </CollapseBody>
              )}
            </div>
          ) : (
            <div className="px-3 py-2 text-[11px] text-ink-400 italic border-t border-ink-100">
              {callStreaming ? "等待工具返回…" : "暂无返回"}
            </div>
          )}

          {done && !isError && outputText && (
            <div className="px-3 py-1.5 bg-ink-50/80 border-t border-ink-100 text-[10px] text-ink-400">
              {outputText.split("\n").length} 行输出
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TextStep({ msg, index, now }: { msg: Message; index: number; now: number }) {
  const durationMs = messageDuration(msg, now);
  const live = isStepLive(msg);

  return (
    <div className="step-timeline-item">
      <div className="step-timeline-node">{index}</div>
      <div className="step-timeline-line" />
      <div className="flex gap-3 flex-1 min-w-0 pb-4 step-timeline-body">
        <StepIcon kind="text" />
        <div className="flex-1 rounded-xl border border-ink-200/70 bg-ink-50/50 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-ink-100 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">中间输出</span>
            <DurationBadge ms={durationMs} live={live} />
          </div>
          <div className="px-3 py-2.5 text-xs text-ink-700 leading-relaxed whitespace-pre-wrap break-words">
            {msg.content ?? ""}
            {msg.isStreaming && <span className="inline-block w-0.5 h-3 bg-brand-400 animate-pulse ml-0.5 align-middle" />}
          </div>
        </div>
      </div>
    </div>
  );
}

function CollapsedBadges({ groups, now }: { groups: StepGroup[]; now: number }) {
  return (
    <div className="flex flex-wrap gap-1.5 min-w-0">
      {groups.map((g, i) => {
        const duration = formatStepSeconds(stepGroupDuration(g, now));
        if (g.kind === "thinking") {
          return (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100/80 text-amber-800 text-[10px] font-medium">
              思考{duration && <span className="font-mono opacity-80">{duration}</span>}
            </span>
          );
        }
        if (g.kind === "tool") {
          const { name } = parseToolCall(g.call.content ?? "");
          const err = g.result ? parseToolResult(g.result.content ?? "").isError : false;
          return (
            <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium ${
              err ? "bg-rose-100/80 text-rose-700" : "bg-brand-100/80 text-brand-800"
            }`}>
              {name}
              {g.result && (err ? " ✗" : " ✓")}
              {duration && <span className="font-mono opacity-80">{duration}</span>}
            </span>
          );
        }
        return (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-ink-100 text-ink-600 text-[10px] font-medium">
            输出{duration && <span className="font-mono opacity-80">{duration}</span>}
          </span>
        );
      })}
    </div>
  );
}

interface Props {
  steps: Message[];
}

export default function ExecutionSteps({ steps }: Props) {
  const groups = groupSteps(steps);
  const isActive = steps.some((s) => s.isStreaming || (s.startedAt && !s.endedAt));
  const now = useLiveClock(isActive);
  const [open, setOpen] = useState(isActive);

  useEffect(() => {
    if (isActive) setOpen(true);
    else setOpen(false);
  }, [isActive]);

  if (steps.length === 0) return null;

  const toolCount = groups.filter((g) => g.kind === "tool").length;
  const thinkCount = groups.filter((g) => g.kind === "thinking").length;

  const totalMs = (() => {
    const starts = steps.map((s) => s.startedAt).filter((t): t is number => t != null);
    if (starts.length === 0) return null;
    const start = Math.min(...starts);
    const ends = steps.map((s) => s.endedAt ?? (s.isStreaming || (s.startedAt && !s.endedAt) ? now : null))
      .filter((t): t is number => t != null);
    if (ends.length === 0) return isActive ? now - start : null;
    return Math.max(...ends) - start;
  })();

  return (
    <div className="max-w-[92%] mb-3">
      <div className="rounded-2xl border border-ink-200/70 bg-gradient-to-b from-white/95 to-ink-50/40 shadow-soft overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-ink-50/50 transition-colors text-left"
        >
          <svg className={`w-4 h-4 shrink-0 text-ink-400 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-ink-700">
                {isActive ? "正在执行" : "执行过程"}
              </span>
              <span className="text-[10px] text-ink-400">
                {groups.length} 步
                {thinkCount > 0 && ` · ${thinkCount} 次思考`}
                {toolCount > 0 && ` · ${toolCount} 次工具`}
                {totalMs != null && formatStepSeconds(totalMs) && ` · 共 ${formatStepSeconds(totalMs)}`}
              </span>
              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />}
            </div>
            {!open && <div className="mt-1.5"><CollapsedBadges groups={groups} now={now} /></div>}
          </div>
        </button>

        {open && (
          <div className="px-4 pb-3 pt-1 border-t border-ink-100/80 step-timeline">
            {groups.map((g, idx) => {
              const n = idx + 1;
              if (g.kind === "thinking") return <ThinkingStep key={idx} msg={g.msg} index={n} now={now} />;
              if (g.kind === "tool") return <ToolStep key={idx} call={g.call} result={g.result} index={n} now={now} />;
              return <TextStep key={idx} msg={g.msg} index={n} now={now} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
