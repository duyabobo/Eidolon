import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useRef, useEffect, useCallback, useState } from "react";
import { APP_LOGO, APP_NAME } from "../../constants/brand";
import { workspaceApi } from "../../api/workspace";
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
/** download API 需要 users/{uid}/ 下的相对路径 */
function resolveWorkspaceDownloadPath(sessionId, relativePath, filename) {
    const path = (relativePath || filename || "").trim();
    if (!path)
        return null;
    if (path.startsWith("sessions/"))
        return path;
    if (!sessionId)
        return null;
    return `sessions/${sessionId}/workspace/${path}`;
}
function toAttachment(msg) {
    return {
        filename: msg.content,
        relativePath: msg.relativePath,
        size: msg.size,
    };
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
        const attachments = assistantMsgs.filter((m) => m.type === "file").map(toAttachment);
        const nonFileMsgs = assistantMsgs.filter((m) => m.type !== "file");
        let finalResultIdx = -1;
        let lastTextIdx = -1;
        for (let j = nonFileMsgs.length - 1; j >= 0; j -= 1) {
            if (finalResultIdx < 0 && nonFileMsgs[j].type === "final_result") {
                finalResultIdx = j;
            }
            if (lastTextIdx < 0 && nonFileMsgs[j].type === "text") {
                lastTextIdx = j;
            }
        }
        const startedAt = resolveTurnStartedAt(assistantMsgs);
        // 有 final_result：此前所有生成内容（含 Step7 叙述）都进中间步骤，最终只展示纯净答案
        if (finalResultIdx >= 0) {
            items.push({
                kind: "assistant",
                turn: {
                    steps: nonFileMsgs.filter((_, idx) => idx !== finalResultIdx),
                    finalText: nonFileMsgs[finalResultIdx],
                    attachments,
                    startedAt,
                },
            });
            continue;
        }
        // 流式进行中：token 一律折叠进中间步骤，不把中间生成当最终回复
        const streaming = nonFileMsgs.some((m) => m.isStreaming);
        if (streaming) {
            items.push({
                kind: "assistant",
                turn: { steps: nonFileMsgs, finalText: null, attachments, startedAt },
            });
            continue;
        }
        // 历史兼容：旧会话无 final_result 时，仍用最后一段 text 作为回复
        const steps = lastTextIdx >= 0 ? nonFileMsgs.slice(0, lastTextIdx) : nonFileMsgs;
        const finalText = lastTextIdx >= 0 ? nonFileMsgs[lastTextIdx] : null;
        items.push({
            kind: "assistant",
            turn: { steps, finalText, attachments, startedAt },
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
function EidolonAvatar() {
    return (_jsx("div", { className: "w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-[10px] font-semibold shrink-0 mt-0.5 shadow-sm", children: APP_LOGO }));
}
function FileChip({ filename, subtitle, title, onDownload, downloading, align, }) {
    const clickable = Boolean(onDownload) && !downloading;
    const className = [
        "rounded-2.5xl px-3.5 py-2.5 text-sm bg-white border border-ink-200/70 text-ink-800 shadow-soft inline-flex items-center gap-2.5 max-w-full text-left",
        align === "right" ? "rounded-br-md" : "rounded-bl-md",
        clickable ? "hover:border-brand-300 hover:bg-brand-50/40 cursor-pointer transition-colors" : "",
        downloading ? "opacity-70 cursor-wait" : "",
    ].filter(Boolean).join(" ");
    const body = (_jsxs(_Fragment, { children: [_jsx("span", { className: "w-8 h-8 rounded-lg bg-ink-100 text-ink-500 flex items-center justify-center text-[10px] font-semibold shrink-0", children: "FILE" }), _jsxs("span", { className: "min-w-0", children: [_jsx("span", { className: "block font-medium truncate", children: downloading ? "下载中…" : filename }), subtitle && (_jsx("span", { className: "block text-[11px] text-ink-400 mt-0.5", children: subtitle })), clickable && (_jsx("span", { className: "block text-[11px] text-brand-600 mt-0.5", children: "\u70B9\u51FB\u4E0B\u8F7D" }))] })] }));
    if (clickable) {
        return (_jsx("button", { type: "button", onClick: onDownload, className: className, title: title || filename, children: body }));
    }
    return (_jsx("div", { className: className, title: title || filename, children: body }));
}
function AssistantTurnBlock({ turn, userId, sessionId, }) {
    const { steps, finalText, attachments, startedAt } = turn;
    const hasSteps = steps.length > 0;
    const onlySteps = hasSteps && !finalText;
    const [downloadingKey, setDownloadingKey] = useState(null);
    const downloadAttachment = useCallback(async (file) => {
        const path = resolveWorkspaceDownloadPath(sessionId, file.relativePath, file.filename);
        if (!userId.trim() || !path)
            return;
        const key = path;
        setDownloadingKey(key);
        try {
            await workspaceApi.download(userId, path, file.filename);
        }
        catch (err) {
            console.error("[MessageList] 附件下载失败", err);
        }
        finally {
            setDownloadingKey(null);
        }
    }, [userId, sessionId]);
    return (_jsxs("div", { className: "flex gap-3 justify-start", children: [_jsx(EidolonAvatar, {}), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx(MessageTime, { ts: startedAt, align: "left" }), hasSteps && _jsx(ExecutionSteps, { steps: steps }), finalText && (_jsxs("div", { className: "max-w-[92%]", children: [hasSteps && (_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1.5 pl-0.5", children: "\u56DE\u590D" })), _jsx("div", { className: "rounded-2.5xl rounded-bl-md px-4 py-3 text-sm leading-relaxed break-words bg-white border border-ink-200/60 text-ink-900 shadow-soft", children: _jsx(ChatMarkdown, { content: finalText.content, streaming: finalText.isStreaming }) }), attachments.length > 0 && (_jsx("div", { className: "mt-2 flex flex-wrap gap-2", children: attachments.map((file) => {
                                    const path = resolveWorkspaceDownloadPath(sessionId, file.relativePath, file.filename);
                                    const sizeLabel = formatFileSize(file.size);
                                    return (_jsx(FileChip, { filename: file.filename, subtitle: sizeLabel || undefined, title: file.relativePath || file.filename, onDownload: path ? () => void downloadAttachment(file) : undefined, downloading: path != null && downloadingKey === path, align: "left" }, path || file.filename));
                                }) }))] })), !finalText && attachments.length > 0 && (_jsx("div", { className: "mt-2 flex flex-wrap gap-2", children: attachments.map((file) => {
                            const path = resolveWorkspaceDownloadPath(sessionId, file.relativePath, file.filename);
                            const sizeLabel = formatFileSize(file.size);
                            return (_jsx(FileChip, { filename: file.filename, subtitle: sizeLabel || undefined, title: file.relativePath || file.filename, onDownload: path ? () => void downloadAttachment(file) : undefined, downloading: path != null && downloadingKey === path, align: "left" }, path || file.filename));
                        }) })), onlySteps && (_jsxs("p", { className: "text-xs text-ink-400 mt-2 pl-1 flex items-center gap-1.5", children: [_jsx("span", { className: "w-1 h-1 rounded-full bg-ink-300 animate-pulse" }), "\u6B63\u5728\u751F\u6210\uFF0C\u5B8C\u6210\u540E\u5C06\u5C55\u793A\u6700\u7EC8\u56DE\u590D\u2026"] }))] })] }));
}
const SCROLL_PIN_THRESHOLD_PX = 80;
function isPinnedToBottom(container) {
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distance <= SCROLL_PIN_THRESHOLD_PX;
}
function scrollToBottom(container, behavior) {
    container.scrollTo({ top: container.scrollHeight, behavior });
}
export default function MessageList({ messages, userId, sessionId }) {
    const displayItems = useMemo(() => groupMessages(messages), [messages]);
    const scrollRef = useRef(null);
    const pinnedToBottomRef = useRef(true);
    const [downloadingUserFile, setDownloadingUserFile] = useState(null);
    const downloadUserFile = useCallback(async (filename, relativePath) => {
        const path = resolveWorkspaceDownloadPath(sessionId, relativePath, filename);
        if (!userId.trim() || !path)
            return;
        setDownloadingUserFile(path);
        try {
            await workspaceApi.download(userId, path, filename);
        }
        catch (err) {
            console.error("[MessageList] 用户附件下载失败", err);
        }
        finally {
            setDownloadingUserFile(null);
        }
    }, [userId, sessionId]);
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
                        const path = resolveWorkspaceDownloadPath(sessionId, item.relativePath, item.filename);
                        return (_jsx("div", { className: "flex justify-end", children: _jsxs("div", { className: "max-w-[78%]", children: [_jsx(MessageTime, { ts: item.startedAt, align: "right" }), _jsx(FileChip, { filename: item.filename, subtitle: subtitle || undefined, title: item.docId
                                            ? `${item.relativePath || item.filename}\ndoc_id: ${item.docId}`
                                            : (item.relativePath || item.filename), onDownload: path ? () => void downloadUserFile(item.filename, item.relativePath) : undefined, downloading: path != null && downloadingUserFile === path, align: "right" })] }) }, i));
                    }
                    return (_jsx(AssistantTurnBlock, { turn: item.turn, userId: userId, sessionId: sessionId }, i));
                })] }) }));
}
