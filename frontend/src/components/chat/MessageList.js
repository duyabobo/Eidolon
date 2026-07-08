import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import ExecutionSteps from "./ExecutionSteps";
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
function PiAvatar() {
    return (_jsx("div", { className: "w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-xs font-semibold shrink-0 mt-0.5 shadow-sm", children: "\u03C0" }));
}
function AssistantTurnBlock({ turn }) {
    const { steps, finalText } = turn;
    const hasSteps = steps.length > 0;
    const onlySteps = hasSteps && !finalText;
    return (_jsxs("div", { className: "flex gap-3 justify-start", children: [_jsx(PiAvatar, {}), _jsxs("div", { className: "flex-1 min-w-0", children: [hasSteps && _jsx(ExecutionSteps, { steps: steps }), finalText && (_jsxs("div", { className: "max-w-[92%]", children: [hasSteps && (_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 pl-0.5", children: "\u56DE\u590D" })), _jsxs("div", { className: "rounded-2.5xl rounded-bl-md px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words bg-white border border-ink-200/60 text-ink-900 shadow-soft", children: [finalText.content, finalText.isStreaming && (_jsx("span", { className: "inline-block w-0.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle rounded-full" }))] })] })), onlySteps && (_jsxs("p", { className: "text-xs text-ink-400 mt-2 pl-1 flex items-center gap-1.5", children: [_jsx("span", { className: "w-1 h-1 rounded-full bg-ink-300 animate-pulse" }), "\u7B49\u5F85\u6700\u7EC8\u56DE\u590D\u2026"] }))] })] }));
}
export default function MessageList({ messages, bottomRef }) {
    const displayItems = useMemo(() => groupMessages(messages), [messages]);
    return (_jsx("div", { className: "flex-1 overflow-y-auto scrollbar-thin", children: _jsxs("div", { className: "page-content py-6 space-y-5", children: [messages.length === 0 && (_jsxs("div", { className: "text-center mt-24 px-4", children: [_jsx("div", { className: "w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-2xl font-bold shadow-soft mb-4", children: "\u03C0" }), _jsx("p", { className: "text-ink-700 font-medium", children: "\u5F00\u59CB\u4E0E Pi Agent \u5BF9\u8BDD" }), _jsx("p", { className: "text-sm text-ink-400 mt-2 leading-relaxed", children: "\u8F93\u5165 / \u53EF\u9009\u62E9 Skill\uFF0CEnter \u53D1\u9001" })] })), displayItems.map((item, i) => {
                    if (item.kind === "user") {
                        return (_jsx("div", { className: "flex justify-end", children: _jsx("div", { className: "max-w-[78%] rounded-2.5xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft", children: item.content }) }, i));
                    }
                    return _jsx(AssistantTurnBlock, { turn: item.turn }, i);
                }), _jsx("div", { ref: bottomRef })] }) }));
}
