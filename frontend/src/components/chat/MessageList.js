import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState, useEffect, useMemo } from "react";
/** 按用户消息切分，每轮助手回复拆成「中间步骤 + 最终输出」 */
function groupMessages(messages) {
    const items = [];
    let i = 0;
    while (i < messages.length) {
        const msg = messages[i];
        if (msg.role === "user") {
            items.push({ kind: "user", content: msg.content });
            i += 1;
            continue;
        }
        const assistantMsgs = [];
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
function StepSummary({ steps }) {
    const parts = [];
    for (const s of steps) {
        if (s.type === "thinking")
            parts.push("思考");
        else if (s.type === "tool_call") {
            try {
                const p = JSON.parse(s.content);
                parts.push(p.name || "工具");
            }
            catch {
                parts.push("工具");
            }
        }
        else if (s.type === "tool_result")
            parts.push("结果");
        else if (s.type === "text")
            parts.push("输出");
    }
    const preview = parts.slice(0, 4).join(" → ");
    const extra = parts.length > 4 ? ` 等 ${parts.length} 步` : "";
    return _jsxs("span", { className: "truncate", children: [preview, extra] });
}
function StepContent({ msg }) {
    if (msg.type === "thinking") {
        return (_jsxs("div", { className: "text-xs", children: [_jsxs("p", { className: "text-amber-600/80 font-medium mb-1 flex items-center gap-1.5", children: ["\u601D\u8003", msg.isStreaming && _jsx("span", { className: "inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" })] }), _jsx("div", { className: "bg-amber-50/60 border border-amber-100 rounded-xl px-3 py-2 text-ink-500 italic whitespace-pre-wrap break-words leading-relaxed", children: msg.content })] }));
    }
    if (msg.type === "tool_call") {
        let name = "";
        let inputText = "";
        try {
            const p = JSON.parse(msg.content);
            name = p.name;
            inputText = JSON.stringify(p.input, null, 2);
        }
        catch {
            inputText = msg.content;
        }
        return (_jsxs("div", { className: "text-xs", children: [_jsx("p", { className: "text-brand-600 font-mono font-medium mb-1", children: name || "工具调用" }), _jsx("pre", { className: "bg-brand-50/50 border border-brand-100 rounded-xl px-3 py-2 text-ink-600 overflow-x-auto", children: inputText })] }));
    }
    if (msg.type === "tool_result") {
        let name = "";
        let outputText = "";
        let isError = false;
        try {
            const p = JSON.parse(msg.content);
            name = p.name;
            outputText = p.output;
            isError = !!p.isError;
        }
        catch {
            outputText = msg.content;
        }
        return (_jsxs("div", { className: "text-xs", children: [_jsx("p", { className: `font-mono font-medium mb-1 ${isError ? "text-rose-500" : "text-emerald-600"}`, children: name ? `${name} 结果` : "执行结果" }), _jsx("pre", { className: `border rounded-xl px-3 py-2 overflow-x-auto max-h-48 ${isError ? "bg-rose-50/60 border-rose-100 text-rose-600" : "bg-emerald-50/60 border-emerald-100 text-ink-600"}`, children: outputText })] }));
    }
    return (_jsxs("div", { className: "text-xs", children: [_jsx("p", { className: "text-ink-400 font-medium mb-1", children: "\u4E2D\u95F4\u8F93\u51FA" }), _jsx("div", { className: "bg-ink-50 border border-ink-100 rounded-xl px-3 py-2 text-ink-600 whitespace-pre-wrap break-words leading-relaxed", children: msg.content })] }));
}
function StepsPanel({ steps }) {
    const isActive = steps.some((s) => s.isStreaming);
    const [open, setOpen] = useState(isActive);
    useEffect(() => {
        if (isActive)
            setOpen(true);
        else
            setOpen(false);
    }, [isActive]);
    if (steps.length === 0)
        return null;
    return (_jsxs("div", { className: "max-w-[85%] mb-2", children: [_jsxs("button", { type: "button", onClick: () => setOpen((v) => !v), className: "flex items-center gap-2 w-full text-left text-xs text-ink-400 hover:text-ink-600 transition-colors py-1", children: [_jsx("svg", { className: `w-3 h-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5l7 7-7 7" }) }), _jsxs("span", { className: "font-medium shrink-0", children: [isActive ? "执行中" : "执行过程", _jsxs("span", { className: "text-ink-300 font-normal ml-1", children: ["(", steps.length, ")"] })] }), !open && (_jsx("span", { className: "text-ink-300 truncate min-w-0", children: _jsx(StepSummary, { steps: steps }) })), isActive && _jsx("span", { className: "inline-block w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse shrink-0" })] }), open && (_jsx("div", { className: "mt-1 ml-5 space-y-3 border-l-2 border-ink-100 pl-3", children: steps.map((s, idx) => (_jsx(StepContent, { msg: s }, idx))) }))] }));
}
function PiAvatar() {
    return (_jsx("div", { className: "w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-xs font-semibold shrink-0 mt-0.5 shadow-sm", children: "\u03C0" }));
}
function AssistantTurnBlock({ turn }) {
    const { steps, finalText } = turn;
    const hasSteps = steps.length > 0;
    const onlySteps = hasSteps && !finalText;
    return (_jsxs("div", { className: "flex gap-3 justify-start", children: [_jsx(PiAvatar, {}), _jsxs("div", { className: "flex-1 min-w-0", children: [hasSteps && _jsx(StepsPanel, { steps: steps }), finalText && (_jsxs("div", { className: "max-w-[85%] rounded-2.5xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-white/90 backdrop-blur-sm border border-ink-200/60 text-ink-900 shadow-soft", children: [finalText.content, finalText.isStreaming && (_jsx("span", { className: "inline-block w-0.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle rounded-full" }))] })), onlySteps && (_jsx("p", { className: "text-xs text-ink-400 mt-1 italic", children: "\u7B49\u5F85\u6700\u7EC8\u56DE\u590D\u2026" }))] })] }));
}
export default function MessageList({ messages, bottomRef }) {
    const displayItems = useMemo(() => groupMessages(messages), [messages]);
    return (_jsx("div", { className: "flex-1 overflow-y-auto scrollbar-thin", children: _jsxs("div", { className: "max-w-3xl mx-auto w-full px-5 py-6 space-y-5", children: [messages.length === 0 && (_jsxs("div", { className: "text-center mt-24 px-4", children: [_jsx("div", { className: "w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-2xl font-bold shadow-soft mb-4", children: "\u03C0" }), _jsx("p", { className: "text-ink-700 font-medium", children: "\u5F00\u59CB\u4E0E Pi Agent \u5BF9\u8BDD" }), _jsx("p", { className: "text-sm text-ink-400 mt-2 leading-relaxed", children: "\u8F93\u5165 / \u53EF\u9009\u62E9 Skill\uFF0CEnter \u53D1\u9001" })] })), displayItems.map((item, i) => {
                    if (item.kind === "user") {
                        return (_jsx("div", { className: "flex justify-end", children: _jsx("div", { className: "max-w-[78%] rounded-2.5xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft", children: item.content }) }, i));
                    }
                    return _jsx(AssistantTurnBlock, { turn: item.turn }, i);
                }), _jsx("div", { ref: bottomRef })] }) }));
}
