import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useChatSession } from "../../context/ChatSessionContext";
import { formatChinaDateTime } from "../../utils/datetime";
export default function ChatHistoryDrawer({ open, onClose }) {
    const { userId, setUserId, sessions, currentSessionId, runtimeTick, loadSessions, switchToSession, isSessionGenerating, startNewChat, } = useChatSession();
    const [editing, setEditing] = useState(false);
    const [draftId, setDraftId] = useState(userId);
    useEffect(() => {
        if (!editing)
            setDraftId(userId);
    }, [userId, editing]);
    useEffect(() => {
        if (!open)
            return undefined;
        const onKey = (e) => {
            if (e.key === "Escape")
                onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, onClose]);
    const saveUserId = () => {
        const trimmed = draftId.trim();
        if (trimmed !== userId.trim())
            startNewChat();
        setUserId(trimmed);
        setEditing(false);
        if (trimmed)
            loadSessions();
    };
    const openSession = async (sessionId) => {
        const session = sessions.find((s) => s.session_id === sessionId);
        if (!session)
            return;
        await switchToSession(session);
        onClose();
    };
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: `fixed inset-0 z-40 bg-ink-900/20 backdrop-blur-[2px] transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`, onClick: onClose, "aria-hidden": !open }), _jsxs("aside", { className: `fixed top-0 right-0 bottom-0 z-50 w-full max-w-sm bg-white/95 backdrop-blur-xl border-l border-ink-200/80 shadow-panel flex flex-col transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`, "aria-hidden": !open, children: [_jsxs("div", { className: "shrink-0 flex items-center justify-between px-5 py-4 border-b border-ink-100", children: [_jsx("h2", { className: "text-base font-semibold text-ink-900", children: "\u5386\u53F2\u5BF9\u8BDD" }), _jsx("button", { type: "button", onClick: onClose, className: "ui-icon-btn", "aria-label": "\u5173\u95ED", children: _jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.8, d: "M6 18L18 6M6 6l12 12" }) }) })] }), _jsxs("div", { className: "flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-6", children: [_jsxs("section", { children: [_jsx("h3", { className: "text-xs font-semibold uppercase tracking-wider text-ink-400 mb-2", children: "\u7528\u6237 ID" }), editing ? (_jsxs("div", { className: "flex gap-2", children: [_jsx("input", { value: draftId, onChange: (e) => setDraftId(e.target.value), placeholder: "alice", className: "ui-field flex-1", autoFocus: true, onKeyDown: (e) => { if (e.key === "Enter")
                                                    saveUserId(); } }), _jsx("button", { type: "button", onClick: saveUserId, className: "ui-btn-primary", children: "\u4FDD\u5B58" })] })) : (_jsxs("div", { className: "flex items-center justify-between gap-3 rounded-xl border border-ink-200/70 bg-ink-50/50 px-3 py-2.5", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-sm font-medium text-ink-900 truncate", children: userId.trim() || "尚未设置" }), _jsx("p", { className: "text-[11px] text-ink-400 mt-0.5", children: "\u533A\u5206\u4E2A\u4EBA\u914D\u7F6E\u4E0E\u5BF9\u8BDD\u8BB0\u5F55" })] }), _jsx("button", { type: "button", onClick: () => setEditing(true), className: "ui-chip bg-white text-ink-600 border-ink-200/80 hover:bg-ink-50 shrink-0", children: userId.trim() ? "修改" : "设置" })] }))] }), _jsxs("section", { children: [_jsx("h3", { className: "text-xs font-semibold uppercase tracking-wider text-ink-400 mb-2", children: "\u4F1A\u8BDD\u5217\u8868" }), !userId.trim() ? (_jsx("p", { className: "text-sm text-ink-400 text-center py-10 rounded-xl border border-dashed border-ink-200", children: "\u8BF7\u5148\u8BBE\u7F6E\u7528\u6237 ID" })) : sessions.length === 0 ? (_jsx("p", { className: "text-sm text-ink-400 text-center py-10 rounded-xl border border-dashed border-ink-200", children: "\u6682\u65E0\u5386\u53F2\u5BF9\u8BDD" })) : (_jsx("div", { className: "rounded-xl border border-ink-200/70 overflow-hidden divide-y divide-ink-100", children: sessions.map((s) => (_jsxs("button", { type: "button", onClick: () => openSession(s.session_id), className: `w-full text-left px-3.5 py-3 transition-colors hover:bg-brand-50/60 ${s.session_id === currentSessionId ? "bg-brand-50/80" : ""}`, children: [_jsx("p", { className: "text-sm text-ink-800 truncate leading-snug", children: s.request }), _jsxs("p", { className: "text-xs text-ink-400 mt-1 flex items-center gap-2", children: [_jsx("span", { className: `inline-block w-1.5 h-1.5 rounded-full ${isSessionGenerating(s.session_id) ? "bg-amber-400 animate-pulse" :
                                                                s.status === "COMPLETED" ? "bg-emerald-400" :
                                                                    s.status === "RUNNING" ? "bg-amber-400" :
                                                                        s.status === "FAILED" ? "bg-rose-400" : "bg-ink-300"}` }), _jsx("span", { children: formatChinaDateTime(s.created_at) })] })] }, `${s.session_id}-${runtimeTick}`))) }))] })] })] })] }));
}
