import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useRef, useEffect } from "react";
import { APP_LOGO, APP_NAME } from "../../constants/brand";
import ChatMarkdown from "./ChatMarkdown";
import ExecutionSteps from "./ExecutionSteps";
import { formatMessageTime } from "./stepTiming";
function formatFileSize(bytes) {
    if (bytes == null || bytes < 0)
        return "";
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function resolveTurnStartedAt(msgs) {
    for (const msg of msgs) {
        if (msg.startedAt != null)
            return msg.startedAt;
    }
    return undefined;
}
function groupMessages(messages) {
    const items = [];
    let i = 0;
    while (i < messages.length) {
        const msg = messages[i];
        if (msg.role === "user") {
            if (msg.type === "file") {
                items.push({
                    kind: "user_file",
                    filename: msg.content,
                    relativePath: msg.relativePath,
                    size: msg.size,
                    docId: msg.docId,
                    startedAt: msg.startedAt,
                });
            }
            else {
                items.push({ kind: "user", content: msg.content, startedAt: msg.startedAt });
            }
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
        items.push({
            kind: "assistant",
            turn: {
                steps,
                finalText,
                startedAt: resolveTurnStartedAt(assistantMsgs),
            },
        });
    }
    return items;
}
function MessageTime({ ts, align }) {
    const label = formatMessageTime(ts);
    if (!label)
        return null;
    return (_jsx("p", { className: `text-[10px] text-ink-400 mt-1 tabular-nums ${align === "right" ? "text-right" : "text-left"}`, children: label }));
}
function OnenewAvatar() {
    return (_jsx("div", { className: "w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-[10px] font-semibold shrink-0 mt-0.5 shadow-sm", children: APP_LOGO }));
}
function AssistantTurnBlock({ turn }) {
    const { steps, finalText, startedAt } = turn;
    const hasSteps = steps.length > 0;
    const onlySteps = hasSteps && !finalText;
    return (_jsxs("div", { className: "flex gap-3 justify-start", children: [_jsx(OnenewAvatar, {}), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx(MessageTime, { ts: startedAt, align: "left" }), hasSteps && _jsx(ExecutionSteps, { steps: steps }), finalText && (_jsxs("div", { className: "max-w-[92%]", children: [hasSteps && (_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 pl-0.5", children: "\u56DE\u590D" })), _jsx("div", { className: "rounded-2.5xl rounded-bl-md px-4 py-3 text-sm leading-relaxed break-words bg-white border border-ink-200/60 text-ink-900 shadow-soft", children: _jsx(ChatMarkdown, { content: finalText.content, streaming: finalText.isStreaming }) })] })), onlySteps && (_jsxs("p", { className: "text-xs text-ink-400 mt-2 pl-1 flex items-center gap-1.5", children: [_jsx("span", { className: "w-1 h-1 rounded-full bg-ink-300 animate-pulse" }), "\u7B49\u5F85\u6700\u7EC8\u56DE\u590D\u2026"] }))] })] }));
}
const SCROLL_PIN_THRESHOLD_PX = 80;
function isPinnedToBottom(container) {
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distance <= SCROLL_PIN_THRESHOLD_PX;
}
function scrollToBottom(container, behavior) {
    container.scrollTo({ top: container.scrollHeight, behavior });
}
export default function MessageList({ messages }) {
    const displayItems = useMemo(() => groupMessages(messages), [messages]);
    const scrollRef = useRef(null);
    const pinnedToBottomRef = useRef(true);
    useEffect(() => {
        const container = scrollRef.current;
        if (!container)
            return;
        const onScroll = () => {
            const pinned = isPinnedToBottom(container);
            const wasPinned = pinnedToBottomRef.current;
            pinnedToBottomRef.current = pinned;
            if (pinned && !wasPinned) {
                scrollToBottom(container, "auto");
            }
        };
        container.addEventListener("scroll", onScroll, { passive: true });
        return () => container.removeEventListener("scroll", onScroll);
    }, []);
    useEffect(() => {
        const container = scrollRef.current;
        if (!container)
            return;
        const last = messages[messages.length - 1];
        const userJustSent = last?.role === "user";
        if (userJustSent) {
            pinnedToBottomRef.current = true;
            scrollToBottom(container, "smooth");
            return;
        }
        const pinned = isPinnedToBottom(container);
        pinnedToBottomRef.current = pinned;
        if (pinned) {
            scrollToBottom(container, "auto");
        }
    }, [messages]);
    return (_jsx("div", { ref: scrollRef, className: "flex-1 overflow-y-auto scrollbar-thin", children: _jsxs("div", { className: "page-content py-6 space-y-5", children: [messages.length === 0 && (_jsxs("div", { className: "text-center mt-24 px-4", children: [_jsx("div", { className: "w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-lg font-bold shadow-soft mb-4", children: APP_LOGO }), _jsxs("p", { className: "text-ink-700 font-medium", children: ["\u5F00\u59CB\u4E0E ", APP_NAME, " \u5BF9\u8BDD"] }), _jsx("p", { className: "text-sm text-ink-400 mt-2 leading-relaxed", children: "\u8F93\u5165 / \u53EF\u9009\u62E9 Skill\uFF0CEnter \u53D1\u9001" })] })), displayItems.map((item, i) => {
                    if (item.kind === "user") {
                        return (_jsx("div", { className: "flex justify-end", children: _jsxs("div", { className: "max-w-[78%]", children: [_jsx(MessageTime, { ts: item.startedAt, align: "right" }), _jsx("div", { className: "rounded-2.5xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft", children: item.content })] }) }, i));
                    }
                    if (item.kind === "user_file") {
                        const sizeLabel = formatFileSize(item.size);
                        const subtitle = [sizeLabel, item.docId ? `doc:${item.docId.slice(0, 8)}…` : ""]
                            .filter(Boolean)
                            .join(" · ");
                        return (_jsx("div", { className: "flex justify-end", children: _jsxs("div", { className: "max-w-[78%]", children: [_jsx(MessageTime, { ts: item.startedAt, align: "right" }), _jsxs("div", { className: "rounded-2.5xl rounded-br-md px-3.5 py-2.5 text-sm bg-white border border-ink-200/70 text-ink-800 shadow-soft inline-flex items-center gap-2.5", title: item.docId
                                            ? `${item.relativePath || item.filename}\ndoc_id: ${item.docId}`
                                            : (item.relativePath || item.filename), children: [_jsx("span", { className: "w-8 h-8 rounded-lg bg-ink-100 text-ink-500 flex items-center justify-center text-[10px] font-semibold shrink-0", children: "FILE" }), _jsxs("span", { className: "min-w-0", children: [_jsx("span", { className: "block font-medium truncate", children: item.filename }), subtitle && (_jsx("span", { className: "block text-[11px] text-ink-400 mt-0.5", children: subtitle }))] })] })] }) }, i));
                    }
                    return _jsx(AssistantTurnBlock, { turn: item.turn }, i);
                })] }) }));
}
