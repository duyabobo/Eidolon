import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { skillCreatorApi } from "../api/skillCreator";
export default function SkillCreatorChat({ userId, scope, onClose, onPublished, embedded = false }) {
    const [sessionId, setSessionId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [draft, setDraft] = useState(null);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [error, setError] = useState(null);
    const bottomRef = useRef(null);
    const scopeLabel = scope === "user" ? "我的 Skill" : "系统 Skill";
    useEffect(() => {
        let cancelled = false;
        skillCreatorApi
            .createSession(userId)
            .then((res) => {
            if (cancelled)
                return;
            setSessionId(res.session_id);
            setMessages([res.message]);
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
    }, [userId]);
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
        try {
            const res = await skillCreatorApi.sendMessage(sessionId, text);
            setMessages((prev) => [...prev, res.message]);
            if (res.draft)
                setDraft(res.draft);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "发送失败");
        }
        finally {
            setSending(false);
        }
    };
    const handlePublish = async () => {
        if (!sessionId || !draft || publishing)
            return;
        setPublishing(true);
        setError(null);
        try {
            const saved = await skillCreatorApi.publish(sessionId, {});
            onPublished({
                name: saved.name,
                description: saved.description,
                tags: saved.tags,
                hidden: saved.hidden,
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
    const panel = (_jsxs("div", { className: `bg-white/95 backdrop-blur-xl rounded-2.5xl shadow-panel w-full flex flex-col border border-ink-200/60 ${embedded ? "h-[70vh]" : "max-w-4xl h-[90vh]"}`, children: [_jsxs("div", { className: "px-6 py-4 border-b border-ink-200/60 flex items-center justify-between shrink-0", children: [_jsxs("div", { children: [_jsxs("h2", { className: "font-semibold text-ink-900", children: ["\u5BF9\u8BDD\u521B\u5EFA", scopeLabel] }), _jsx("p", { className: "text-xs text-ink-400 mt-0.5", children: "\u901A\u8FC7 skill-creator \u5BF9\u8BDD\u751F\u6210\uFF0C\u4FDD\u5B58\u540E\u540C\u6B65 MongoDB + NFS" })] }), _jsx("button", { type: "button", onClick: onClose, className: "text-sm text-ink-400 hover:text-ink-700 transition-colors", children: "\u5173\u95ED" })] }), _jsxs("div", { className: "flex-1 flex min-h-0", children: [_jsxs("div", { className: "flex-1 flex flex-col border-r min-w-0", children: [_jsxs("div", { className: "flex-1 overflow-y-auto px-4 py-4 space-y-3", children: [loading && _jsx("p", { className: "text-sm text-gray-400 text-center py-8", children: "\u6B63\u5728\u8FDE\u63A5 Skill \u521B\u5EFA\u52A9\u624B\u2026" }), messages.map((m, i) => (_jsx("div", { className: `flex ${m.role === "user" ? "justify-end" : "justify-start"}`, children: _jsx("div", { className: `max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed ${m.role === "user" ? "bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft" : "bg-ink-100/80 text-ink-800 border border-ink-200/60"}`, children: m.content }) }, i))), sending && _jsx("p", { className: "text-xs text-gray-400", children: "\u52A9\u624B\u601D\u8003\u4E2D\u2026" }), _jsx("div", { ref: bottomRef })] }), error && (_jsx("p", { className: "mx-4 mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2", children: error })), _jsxs("div", { className: "px-4 py-3 border-t flex gap-2 shrink-0", children: [_jsx("textarea", { rows: 2, value: input, onChange: (e) => setInput(e.target.value), onKeyDown: (e) => {
                                            if (e.key === "Enter" && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSend();
                                            }
                                        }, placeholder: "\u63CF\u8FF0\u4F60\u60F3\u521B\u5EFA\u7684 Skill\u2026", disabled: loading || sending || !sessionId, className: "flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400" }), _jsx("button", { onClick: handleSend, disabled: loading || sending || !sessionId || !input.trim(), className: "px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 shrink-0", children: "\u53D1\u9001" })] })] }), _jsxs("div", { className: "w-80 flex flex-col shrink-0 bg-gray-50", children: [_jsxs("div", { className: "px-4 py-3 border-b", children: [_jsx("h3", { className: "text-sm font-medium text-gray-700", children: "\u8349\u7A3F\u9884\u89C8" }), _jsx("p", { className: "text-xs text-gray-500 mt-0.5", children: "\u7EE7\u7EED\u5BF9\u8BDD\u5B8C\u5584\uFF0C\u5B9A\u7A3F\u540E\u4FDD\u5B58" })] }), _jsx("div", { className: "flex-1 overflow-y-auto px-4 py-3 space-y-2 text-xs", children: !draft ? (_jsx("p", { className: "text-gray-400 text-center py-8", children: "\u5BF9\u8BDD\u751F\u6210 Skill \u540E\u663E\u793A\u5728\u6B64" })) : (_jsxs(_Fragment, { children: [_jsx(PreviewRow, { label: "\u540D\u79F0", value: draft.name }), _jsx(PreviewRow, { label: "\u63CF\u8FF0", value: draft.description }), (draft.tags ?? []).length > 0 && (_jsx(PreviewRow, { label: "\u6807\u7B7E", value: (draft.tags ?? []).join(", ") })), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-600 mb-1", children: "\u6B63\u6587" }), _jsx("pre", { className: "bg-white border rounded-lg p-2 text-[10px] whitespace-pre-wrap max-h-48 overflow-y-auto font-mono", children: draft.content })] })] })) }), _jsx("div", { className: "px-4 py-3 border-t", children: _jsx("button", { onClick: handlePublish, disabled: !draft || publishing, className: "w-full px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50", children: publishing ? "保存中…" : "保存 Skill" }) })] })] })] }));
    if (embedded)
        return panel;
    return (_jsx("div", { className: "fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4", children: panel }));
}
function PreviewRow({ label, value }) {
    return (_jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-600", children: label }), _jsx("p", { className: "text-gray-800 mt-0.5", children: value })] }));
}
