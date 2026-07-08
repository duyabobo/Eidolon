import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { formatStepSeconds, messageDuration, toolStepDuration, isStepLive, stepGroupDuration, } from "./stepTiming";
export function groupSteps(steps) {
    const groups = [];
    let i = 0;
    while (i < steps.length) {
        const s = steps[i];
        if (s.type === "thinking") {
            groups.push({ kind: "thinking", msg: s });
            i += 1;
        }
        else if (s.type === "tool_call") {
            const next = steps[i + 1];
            if (next?.type === "tool_result") {
                groups.push({ kind: "tool", call: s, result: next });
                i += 2;
            }
            else {
                groups.push({ kind: "tool", call: s });
                i += 1;
            }
        }
        else if (s.type === "tool_result") {
            groups.push({
                kind: "tool",
                call: { role: "assistant", type: "tool_call", content: "{}" },
                result: s,
            });
            i += 1;
        }
        else {
            groups.push({ kind: "text", msg: s });
            i += 1;
        }
    }
    return groups;
}
function parseToolCall(content) {
    const raw = content ?? "";
    try {
        const p = JSON.parse(raw);
        const inputText = JSON.stringify(p.input ?? null, null, 2) ?? "null";
        return {
            name: p.name || "工具",
            input: p.input,
            inputText,
        };
    }
    catch {
        return { name: "工具", input: null, inputText: raw };
    }
}
function parseToolResult(content) {
    const raw = content ?? "";
    try {
        const p = JSON.parse(raw);
        return { name: p.name || "", output: p.output ?? "", isError: !!p.isError };
    }
    catch {
        return { name: "", output: raw, isError: false };
    }
}
/** 从 tool input 提取一行摘要 */
function toolInputPreview(input, inputText) {
    if (input && typeof input === "object" && !Array.isArray(input)) {
        const obj = input;
        if (typeof obj.command === "string")
            return obj.command;
        if (typeof obj.query === "string")
            return obj.query;
        if (typeof obj.path === "string")
            return obj.path;
        const first = Object.values(obj).find((v) => typeof v === "string");
        if (typeof first === "string")
            return first.length > 120 ? `${first.slice(0, 120)}…` : first;
    }
    const safe = inputText ?? "";
    const oneLine = safe.replace(/\s+/g, " ").trim();
    return oneLine.length > 100 ? `${oneLine.slice(0, 100)}…` : oneLine;
}
function outputPreview(text, maxLines = 3) {
    const safe = text ?? "";
    const lines = safe.split("\n");
    if (lines.length <= maxLines && safe.length <= 280)
        return { preview: safe, truncated: false };
    const clipped = lines.slice(0, maxLines).join("\n");
    const preview = clipped.length > 280 ? `${clipped.slice(0, 280)}…` : clipped;
    return { preview, truncated: true };
}
function useLiveClock(active) {
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
function DurationBadge({ ms, live }) {
    const label = formatStepSeconds(ms);
    if (!label)
        return null;
    return (_jsxs("span", { className: `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono tabular-nums shrink-0 ${live ? "bg-brand-50 text-brand-600 ring-1 ring-brand-200/60" : "bg-ink-100/90 text-ink-500"}`, children: [_jsx("svg", { className: "w-2.5 h-2.5 opacity-70", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" }) }), label] }));
}
function CollapseBody({ title, children, defaultOpen = false }) {
    const [open, setOpen] = useState(defaultOpen);
    return (_jsxs("div", { className: "mt-2", children: [_jsxs("button", { type: "button", onClick: () => setOpen((v) => !v), className: "text-[11px] text-ink-400 hover:text-brand-600 transition-colors flex items-center gap-1", children: [_jsx("svg", { className: `w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5l7 7-7 7" }) }), title] }), open && _jsx("div", { className: "mt-1.5", children: children })] }));
}
function StepIcon({ kind, isError }) {
    const base = "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 shadow-sm";
    if (kind === "thinking") {
        return (_jsx("div", { className: `${base} bg-amber-100 text-amber-700`, children: _jsx("svg", { className: "w-3.5 h-3.5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" }) }) }));
    }
    if (kind === "tool") {
        return (_jsx("div", { className: `${base} ${isError ? "bg-rose-100 text-rose-600" : "bg-brand-100 text-brand-700"}`, children: _jsx("svg", { className: "w-3.5 h-3.5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" }) }) }));
    }
    return (_jsx("div", { className: `${base} bg-ink-100 text-ink-500`, children: _jsx("svg", { className: "w-3.5 h-3.5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" }) }) }));
}
function ThinkingStep({ msg, index, now }) {
    const streaming = !!msg.isStreaming;
    const content = msg.content ?? "";
    const preview = content.length > 160 ? `${content.slice(0, 160)}…` : content;
    const durationMs = messageDuration(msg, now);
    const live = isStepLive(msg);
    return (_jsxs("div", { className: "step-timeline-item", children: [_jsx("div", { className: "step-timeline-node", children: index }), _jsx("div", { className: "step-timeline-line" }), _jsxs("div", { className: "flex gap-3 flex-1 min-w-0 pb-4 step-timeline-body", children: [_jsx(StepIcon, { kind: "thinking" }), _jsxs("div", { className: "flex-1 min-w-0 rounded-xl border border-amber-200/70 bg-gradient-to-br from-amber-50/90 to-orange-50/40 overflow-hidden", children: [_jsxs("div", { className: "px-3 py-2 border-b border-amber-100/80 flex items-center justify-between gap-2", children: [_jsx("span", { className: "text-xs font-semibold text-amber-800 tracking-wide", children: "\u601D\u8003" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(DurationBadge, { ms: durationMs, live: live }), streaming && (_jsxs("span", { className: "text-[10px] text-amber-600 flex items-center gap-1", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" }), "\u8FDB\u884C\u4E2D"] }))] })] }), _jsx("div", { className: "px-3 py-2.5 text-xs text-amber-900/70 italic leading-relaxed whitespace-pre-wrap break-words", children: streaming ? content : preview }), !streaming && content.length > 160 && (_jsx(CollapseBody, { title: "\u67E5\u770B\u5B8C\u6574\u601D\u8003", children: _jsx("div", { className: "px-3 pb-2.5 text-xs text-amber-900/70 italic whitespace-pre-wrap break-words leading-relaxed", children: content }) }))] })] })] }));
}
function ToolStep({ call, result, index, now }) {
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
    return (_jsxs("div", { className: "step-timeline-item", children: [_jsx("div", { className: "step-timeline-node", children: index }), _jsx("div", { className: "step-timeline-line" }), _jsxs("div", { className: "flex gap-3 flex-1 min-w-0 pb-4 step-timeline-body", children: [_jsx(StepIcon, { kind: "tool", isError: isError }), _jsxs("div", { className: `flex-1 min-w-0 rounded-xl border overflow-hidden shadow-soft ${isError ? "border-rose-200/80 bg-white" : "border-brand-200/60 bg-white"}`, children: [_jsxs("div", { className: "px-3 py-2 flex items-center justify-between gap-2 border-b border-ink-100/80 bg-white/60", children: [_jsx("code", { className: "text-sm font-semibold text-brand-800 truncate", children: name }), _jsxs("div", { className: "flex items-center gap-2 shrink-0", children: [_jsx(DurationBadge, { ms: durationMs, live: live }), (callStreaming || resultStreaming) && (_jsxs("span", { className: "text-[10px] text-brand-500 flex items-center gap-1", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" }), "\u6267\u884C\u4E2D"] }))] })] }), _jsxs("div", { className: "px-3 py-2.5 bg-gradient-to-r from-brand-50/80 to-violet-50/40 border-b border-brand-100/60", children: [_jsx("div", { className: "flex items-center gap-2 min-w-0", children: _jsx("span", { className: "text-[10px] uppercase tracking-wider text-brand-500 font-semibold", children: "\u8C03\u7528" }) }), inputHighlight && (_jsx("pre", { className: "mt-2 text-xs font-mono text-ink-700 bg-white/70 border border-brand-100/80 rounded-lg px-2.5 py-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed", children: inputHighlight })), _jsx(CollapseBody, { title: "\u67E5\u770B\u5B8C\u6574\u53C2\u6570", children: _jsx("pre", { className: "text-[11px] font-mono text-ink-600 bg-ink-50 rounded-lg px-2.5 py-2 overflow-x-auto", children: inputText }) })] }), result ? (_jsxs("div", { className: `px-3 py-2.5 ${isError ? "bg-rose-50/50" : "bg-emerald-50/30"}`, children: [_jsxs("div", { className: "flex items-center gap-2 mb-1.5", children: [_jsxs("span", { className: `inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${isError ? "text-rose-600" : "text-emerald-600"}`, children: [isError ? (_jsx("svg", { className: "w-3 h-3", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2.5, d: "M6 18L18 6M6 6l12 12" }) })) : (_jsx("svg", { className: "w-3 h-3", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2.5, d: "M5 13l4 4L19 7" }) })), isError ? "失败" : "成功"] }), resultName && resultName !== name && (_jsx("code", { className: "text-[11px] text-ink-400", children: resultName })), resultStreaming && _jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" })] }), _jsx("pre", { className: `text-xs font-mono leading-relaxed whitespace-pre-wrap break-words ${isError ? "text-rose-700" : "text-ink-700"}`, children: resultStreaming ? outputText : outPreview }), !resultStreaming && outTruncated && (_jsx(CollapseBody, { title: "\u67E5\u770B\u5B8C\u6574\u8F93\u51FA", children: _jsx("pre", { className: `text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words max-h-64 overflow-y-auto scrollbar-thin ${isError ? "text-rose-700" : "text-ink-600"}`, children: outputText }) }))] })) : (_jsx("div", { className: "px-3 py-2 text-[11px] text-ink-400 italic border-t border-ink-100", children: callStreaming ? "等待工具返回…" : "暂无返回" })), done && !isError && outputText && (_jsxs("div", { className: "px-3 py-1.5 bg-ink-50/80 border-t border-ink-100 text-[10px] text-ink-400", children: [outputText.split("\n").length, " \u884C\u8F93\u51FA"] }))] })] })] }));
}
function TextStep({ msg, index, now }) {
    const durationMs = messageDuration(msg, now);
    const live = isStepLive(msg);
    return (_jsxs("div", { className: "step-timeline-item", children: [_jsx("div", { className: "step-timeline-node", children: index }), _jsx("div", { className: "step-timeline-line" }), _jsxs("div", { className: "flex gap-3 flex-1 min-w-0 pb-4 step-timeline-body", children: [_jsx(StepIcon, { kind: "text" }), _jsxs("div", { className: "flex-1 rounded-xl border border-ink-200/70 bg-ink-50/50 overflow-hidden", children: [_jsxs("div", { className: "px-3 py-1.5 border-b border-ink-100 flex items-center justify-between gap-2", children: [_jsx("span", { className: "text-[10px] font-semibold uppercase tracking-wider text-ink-400", children: "\u4E2D\u95F4\u8F93\u51FA" }), _jsx(DurationBadge, { ms: durationMs, live: live })] }), _jsxs("div", { className: "px-3 py-2.5 text-xs text-ink-700 leading-relaxed whitespace-pre-wrap break-words", children: [msg.content ?? "", msg.isStreaming && _jsx("span", { className: "inline-block w-0.5 h-3 bg-brand-400 animate-pulse ml-0.5 align-middle" })] })] })] })] }));
}
function CollapsedBadges({ groups, now }) {
    return (_jsx("div", { className: "flex flex-wrap gap-1.5 min-w-0", children: groups.map((g, i) => {
            const duration = formatStepSeconds(stepGroupDuration(g, now));
            if (g.kind === "thinking") {
                return (_jsxs("span", { className: "inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100/80 text-amber-800 text-[10px] font-medium", children: ["\u601D\u8003", duration && _jsx("span", { className: "font-mono opacity-80", children: duration })] }, i));
            }
            if (g.kind === "tool") {
                const { name } = parseToolCall(g.call.content ?? "");
                const err = g.result ? parseToolResult(g.result.content ?? "").isError : false;
                return (_jsxs("span", { className: `inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium ${err ? "bg-rose-100/80 text-rose-700" : "bg-brand-100/80 text-brand-800"}`, children: [name, g.result && (err ? " ✗" : " ✓"), duration && _jsx("span", { className: "font-mono opacity-80", children: duration })] }, i));
            }
            return (_jsxs("span", { className: "inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-ink-100 text-ink-600 text-[10px] font-medium", children: ["\u8F93\u51FA", duration && _jsx("span", { className: "font-mono opacity-80", children: duration })] }, i));
        }) }));
}
export default function ExecutionSteps({ steps }) {
    const groups = groupSteps(steps);
    const isActive = steps.some((s) => s.isStreaming || (s.startedAt && !s.endedAt));
    const now = useLiveClock(isActive);
    const [open, setOpen] = useState(isActive);
    useEffect(() => {
        if (isActive)
            setOpen(true);
        else
            setOpen(false);
    }, [isActive]);
    if (steps.length === 0)
        return null;
    const toolCount = groups.filter((g) => g.kind === "tool").length;
    const thinkCount = groups.filter((g) => g.kind === "thinking").length;
    const totalMs = (() => {
        const starts = steps.map((s) => s.startedAt).filter((t) => t != null);
        if (starts.length === 0)
            return null;
        const start = Math.min(...starts);
        const ends = steps.map((s) => s.endedAt ?? (s.isStreaming || (s.startedAt && !s.endedAt) ? now : null))
            .filter((t) => t != null);
        if (ends.length === 0)
            return isActive ? now - start : null;
        return Math.max(...ends) - start;
    })();
    return (_jsx("div", { className: "max-w-[92%] mb-3", children: _jsxs("div", { className: "rounded-2xl border border-ink-200/70 bg-gradient-to-b from-white/95 to-ink-50/40 shadow-soft overflow-hidden", children: [_jsxs("button", { type: "button", onClick: () => setOpen((v) => !v), className: "w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-ink-50/50 transition-colors text-left", children: [_jsx("svg", { className: `w-4 h-4 shrink-0 text-ink-400 transition-transform ${open ? "rotate-90" : ""}`, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5l7 7-7 7" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "text-xs font-semibold text-ink-700", children: isActive ? "正在执行" : "执行过程" }), _jsxs("span", { className: "text-[10px] text-ink-400", children: [groups.length, " \u6B65", thinkCount > 0 && ` · ${thinkCount} 次思考`, toolCount > 0 && ` · ${toolCount} 次工具`, totalMs != null && formatStepSeconds(totalMs) && ` · 共 ${formatStepSeconds(totalMs)}`] }), isActive && _jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" })] }), !open && _jsx("div", { className: "mt-1.5", children: _jsx(CollapsedBadges, { groups: groups, now: now }) })] })] }), open && (_jsx("div", { className: "px-4 pb-3 pt-1 border-t border-ink-100/80 step-timeline", children: groups.map((g, idx) => {
                        const n = idx + 1;
                        if (g.kind === "thinking")
                            return _jsx(ThinkingStep, { msg: g.msg, index: n, now: now }, idx);
                        if (g.kind === "tool")
                            return _jsx(ToolStep, { call: g.call, result: g.result, index: n, now: now }, idx);
                        return _jsx(TextStep, { msg: g.msg, index: n, now: now }, idx);
                    }) }))] }) }));
}
