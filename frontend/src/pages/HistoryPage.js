import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useChatSession } from "../context/ChatSessionContext";
import { formatChinaDateTime } from "../utils/datetime";
export default function HistoryPage() {
    const navigate = useNavigate();
    const { userId, setUserId, sessions, currentSessionId, runtimeTick, loadSessions, switchToSession, isSessionGenerating, startNewChat, } = useChatSession();
    const [editing, setEditing] = useState(false);
    const [draftId, setDraftId] = useState(userId);
    useEffect(() => { if (!editing)
        setDraftId(userId); }, [userId, editing]);
    const startEdit = () => {
        setDraftId(userId);
        setEditing(true);
    };
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
        navigate("/");
    };
    return (_jsx("div", { className: "h-full overflow-y-auto scrollbar-thin", children: _jsxs("div", { className: "page-content py-8 space-y-8", children: [_jsxs("section", { children: [_jsx("h2", { className: "text-sm font-semibold text-ink-700 mb-3", children: "\u7528\u6237 ID" }), _jsx("div", { className: "bg-white/80 backdrop-blur-sm rounded-2xl border border-ink-200/60 shadow-soft p-4", children: editing ? (_jsxs("div", { className: "flex gap-2", children: [_jsx("input", { value: draftId, onChange: (e) => setDraftId(e.target.value), placeholder: "alice", className: "ui-field flex-1", autoFocus: true, onKeyDown: (e) => { if (e.key === "Enter")
                                            saveUserId(); } }), _jsx("button", { type: "button", onClick: saveUserId, className: "ui-btn-primary", children: "\u4FDD\u5B58" }), _jsx("button", { type: "button", onClick: () => setEditing(false), className: "px-4 py-2.5 text-sm text-ink-500 hover:text-ink-700", children: "\u53D6\u6D88" })] })) : (_jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsxs("div", { children: [userId.trim() ? (_jsx("p", { className: "text-base font-medium text-ink-900", children: userId })) : (_jsx("p", { className: "text-sm text-ink-400", children: "\u5C1A\u672A\u8BBE\u7F6E\uFF0C\u8BF7\u5148\u586B\u5199\u7528\u6237 ID" })), _jsx("p", { className: "text-xs text-ink-400 mt-1", children: "\u7528\u4E8E\u533A\u5206\u4E2A\u4EBA Skill\u3001MCP\u3001\u77E5\u8BC6\u5E93\u4E0E\u5BF9\u8BDD\u8BB0\u5F55" })] }), _jsx("button", { type: "button", onClick: startEdit, className: "ui-chip bg-ink-50 text-ink-600 border-ink-200/80 hover:bg-ink-100", children: userId.trim() ? "修改" : "设置" })] })) })] }), _jsxs("section", { children: [_jsx("h2", { className: "text-sm font-semibold text-ink-700 mb-3", children: "\u5386\u53F2\u5BF9\u8BDD" }), !userId.trim() ? (_jsx("p", { className: "text-sm text-ink-400 text-center py-12 bg-white/60 rounded-2xl border border-dashed border-ink-200", children: "\u8BF7\u5148\u8BBE\u7F6E\u7528\u6237 ID" })) : sessions.length === 0 ? (_jsx("p", { className: "text-sm text-ink-400 text-center py-12 bg-white/60 rounded-2xl border border-dashed border-ink-200", children: "\u6682\u65E0\u5386\u53F2\u5BF9\u8BDD" })) : (_jsx("div", { className: "bg-white/80 backdrop-blur-sm rounded-2xl border border-ink-200/60 shadow-soft overflow-hidden divide-y divide-ink-100", children: sessions.map((s) => (_jsxs("button", { type: "button", onClick: () => openSession(s.session_id), className: `w-full text-left px-4 py-3.5 transition-colors hover:bg-brand-50/50 ${s.session_id === currentSessionId ? "bg-brand-50/80" : ""}`, children: [_jsx("p", { className: "text-sm text-ink-800 truncate leading-snug", children: s.request }), _jsxs("p", { className: "text-xs text-ink-400 mt-1 flex items-center gap-2", children: [_jsx("span", { className: `inline-block w-1.5 h-1.5 rounded-full ${isSessionGenerating(s.session_id) ? "bg-amber-400 animate-pulse" :
                                                    s.status === "COMPLETED" ? "bg-emerald-400" :
                                                        s.status === "RUNNING" ? "bg-amber-400" :
                                                            s.status === "FAILED" ? "bg-rose-400" : "bg-ink-300"}` }), _jsx("span", { children: formatChinaDateTime(s.created_at) })] })] }, `${s.session_id}-${runtimeTick}`))) }))] })] }) }));
}
