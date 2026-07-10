import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { skillCreatorApi } from "../api/skillCreator";
import ChatMarkdown from "./chat/ChatMarkdown";
export default function SkillCreatorChat({ userId, scope, onClose, onPublished, embedded = false, editSkillName }) {
    const [sessionId, setSessionId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [draft, setDraft] = useState(null);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [error, setError] = useState(null);
    // 当前会话是否已发布（已发布时才显示「新建对话」按钮）
    const [isPublished, setIsPublished] = useState(false);
    const bottomRef = useRef(null);
    const abortCtrlRef = useRef(null);
    const scopeLabel = scope === "user" ? "我的 Skill" : "系统 Skill";
    const isEditMode = !!editSkillName;
    const openSession = (forceNew = false, skillName) => {
        setLoading(true);
        setError(null);
        let cancelled = false;
        skillCreatorApi
            .openSession(userId, forceNew, skillName)
            .then((session) => {
            if (cancelled)
                return;
            setSessionId(session.id);
            setMessages(session.messages);
            setDraft(session.draft ?? null);
            setIsPublished(session.published ?? false);
        })
            .catch((e) => {
            if (!cancelled)
                setError(e instanceof Error ? e.message : "无法启动 Skill 创建助手");
        })
            .finally(() => {
            if (!cancelled)
                setLoading(false);
        });
        return () => { cancelled = true; };
    };
    useEffect(() => {
        return openSession(false, editSkillName);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, editSkillName]);
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, draft]);
    const handleSend = async () => {
        const text = input.trim();
        if (!text || !sessionId || sending)
            return;
        setInput("");
        setSending(true);
        setError(null);
        setMessages((prev) => [...prev, { role: "user", content: text }]);
        const ctrl = new AbortController();
        abortCtrlRef.current = ctrl;
        try {
            const res = await skillCreatorApi.sendMessage(sessionId, text, ctrl.signal);
            setMessages((prev) => [...prev, res.message]);
            if (res.draft)
                setDraft(res.draft);
        }
        catch (e) {
            if (e instanceof Error && e.name === "AbortError") {
                // 用户主动中断，不展示错误
            }
            else {
                setError(e instanceof Error ? e.message : "发送失败");
            }
        }
        finally {
            abortCtrlRef.current = null;
            setSending(false);
        }
    };
    const handleInterrupt = () => {
        abortCtrlRef.current?.abort();
    };
    const handleKeyDown = (e) => {
        // 中文输入法组合期间的 Enter 不触发发送
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSend();
        }
    };
    const handlePublish = async () => {
        if (!sessionId || !draft || publishing)
            return;
        setPublishing(true);
        setError(null);
        try {
            const saved = await skillCreatorApi.publish(sessionId, {});
            setIsPublished(true);
            onPublished({
                name: saved.name,
                description: saved.description,
                tags: saved.tags ?? [],
                hidden: saved.hidden ?? false,
                scope,
                user_id: saved.user_id ?? userId ?? null,
            });
            onClose();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "保存失败");
        }
        finally {
            setPublishing(false);
        }
    };
    const panel = (_jsxs("div", { className: `bg-white/95 backdrop-blur-xl rounded-2.5xl shadow-panel w-full flex flex-col border border-ink-200/60 ${embedded ? "h-[70vh]" : "max-w-4xl h-[90vh]"}`, children: [_jsxs("div", { className: "px-6 py-4 border-b border-ink-200/60 flex items-center justify-between shrink-0", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-semibold text-ink-900", children: isEditMode ? `编辑 Skill：${editSkillName}` : `对话创建${scopeLabel}` }), _jsx("p", { className: "text-xs text-ink-400 mt-0.5", children: isEditMode ? "继续对话完善已保存的 Skill，修改后重新保存" : "通过对话生成 Skill；若依赖外部工具，请说明 MCP Server 名称与用途" })] }), _jsxs("div", { className: "flex items-center gap-3", children: [!isPublished && !isEditMode && sessionId && (_jsx("button", { type: "button", onClick: () => {
                                    if (!confirm("确认清除当前对话历史，重新开始？"))
                                        return;
                                    skillCreatorApi.resetSession(sessionId).then((session) => {
                                        setMessages(session.messages);
                                        setDraft(null);
                                        setInput("");
                                    });
                                }, disabled: loading || sending, className: "text-xs text-ink-400 hover:text-red-500 disabled:opacity-40 transition-colors", children: "\u91CD\u65B0\u5F00\u59CB" })), isPublished && !isEditMode && (_jsx("button", { type: "button", onClick: () => {
                                    setDraft(null);
                                    setInput("");
                                    setIsPublished(false);
                                    openSession(true);
                                }, disabled: loading || sending, className: "text-xs text-ink-400 hover:text-brand-600 disabled:opacity-40 transition-colors", children: "\u65B0\u5EFA\u5BF9\u8BDD" })), _jsx("button", { type: "button", onClick: onClose, className: "text-sm text-ink-400 hover:text-ink-700 transition-colors", children: "\u5173\u95ED" })] })] }), _jsxs("div", { className: "flex-1 flex min-h-0", children: [_jsxs("div", { className: "flex-1 flex flex-col border-r min-w-0", children: [_jsxs("div", { className: "flex-1 overflow-y-auto px-4 py-4 space-y-3", children: [loading && _jsx("p", { className: "text-sm text-gray-400 text-center py-8", children: "\u6B63\u5728\u8FDE\u63A5 Skill \u521B\u5EFA\u52A9\u624B\u2026" }), messages.map((m, i) => (_jsx("div", { className: `flex ${m.role === "user" ? "justify-end" : "justify-start"}`, children: _jsx("div", { className: `max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === "user"
                                                ? "bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft whitespace-pre-wrap"
                                                : "bg-ink-100/80 text-ink-800 border border-ink-200/60"}`, children: m.role === "user" ? m.content : _jsx(ChatMarkdown, { content: m.content }) }) }, i))), sending && _jsx("p", { className: "text-xs text-gray-400", children: "\u52A9\u624B\u601D\u8003\u4E2D\u2026" }), _jsx("div", { ref: bottomRef })] }), error && (_jsx("p", { className: "mx-4 mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2", children: error })), _jsxs("div", { className: "px-4 py-3 border-t flex gap-2 items-end shrink-0", children: [_jsx("textarea", { rows: 2, value: input, onChange: (e) => setInput(e.target.value), onKeyDown: handleKeyDown, placeholder: "\u63CF\u8FF0 Skill \u573A\u666F\uFF1B\u82E5\u7528 MCP\uFF0C\u8BF7\u5199\u6E05 Server \u540D\u79F0\u4E0E\u7528\u9014\u2026  Shift+Enter \u6362\u884C", disabled: loading || !sessionId, className: "flex-1 resize-none bg-transparent border border-ink-200/80 rounded-xl px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-300 transition-all duration-200 disabled:opacity-60" }), sending ? (_jsx("button", { type: "button", onClick: handleInterrupt, className: "ui-btn-danger shrink-0", children: "\u4E2D\u65AD" })) : (_jsx("button", { type: "button", onClick: handleSend, disabled: loading || !sessionId || !input.trim(), className: "ui-btn-primary shrink-0", children: "\u53D1\u9001" }))] })] }), _jsxs("div", { className: "w-80 flex flex-col shrink-0 bg-gray-50", children: [_jsxs("div", { className: "px-4 py-3 border-b", children: [_jsx("h3", { className: "text-sm font-medium text-gray-700", children: "\u8349\u7A3F\u9884\u89C8" }), _jsx("p", { className: "text-xs text-gray-500 mt-0.5", children: "\u7EE7\u7EED\u5BF9\u8BDD\u5B8C\u5584\uFF0C\u5B9A\u7A3F\u540E\u4FDD\u5B58" })] }), _jsx("div", { className: "flex-1 overflow-y-auto px-4 py-3 space-y-2 text-xs", children: !draft ? (_jsx("p", { className: "text-gray-400 text-center py-8", children: "\u5BF9\u8BDD\u751F\u6210 Skill \u540E\u663E\u793A\u5728\u6B64" })) : (_jsxs(_Fragment, { children: [_jsx(PreviewRow, { label: "\u540D\u79F0", value: draft.name }), _jsx(PreviewRow, { label: "\u63CF\u8FF0", value: draft.description }), (draft.tags ?? []).length > 0 && (_jsx(PreviewRow, { label: "\u6807\u7B7E", value: (draft.tags ?? []).join(", ") })), (draft.mcp_servers ?? []).length > 0 && (_jsx(PreviewRow, { label: "MCP Servers", value: (draft.mcp_servers ?? []).join(", ") })), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-600 mb-1", children: "\u6B63\u6587" }), _jsx("pre", { className: "bg-white border rounded-lg p-2 text-[10px] whitespace-pre-wrap max-h-48 overflow-y-auto font-mono", children: draft.content })] })] })) }), _jsx("div", { className: "px-4 py-3 border-t", children: _jsx("button", { onClick: handlePublish, disabled: !draft || publishing, className: "w-full ui-btn-primary", children: publishing ? "保存中…" : "保存 Skill" }) })] })] })] }));
    if (embedded)
        return panel;
    return (_jsx("div", { className: "fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4", children: panel }));
}
function PreviewRow({ label, value }) {
    return (_jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-600", children: label }), _jsx("p", { className: "text-gray-800 mt-0.5", children: value })] }));
}
