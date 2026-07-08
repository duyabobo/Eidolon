import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef, useEffect, useCallback } from "react";
import { createSession, sendMessage, cancelTurn, streamTurn, getRecentSessions, getSessionDetail, getActiveTurn, } from "../api/session";
import { skillsApi, toSkillRef } from "../api/skills";
import SkillCreatorChat from "../components/SkillCreatorChat";
import UserMcpPanel from "../components/UserMcpPanel";
// ── 快照重建 ────────────────────────────────────────────────────────────────
function buildMessagesFromSnapshot(request, snapshot) {
    // 新格式：snapshot 含 user_message 事件，直接从 snapshot 重建完整对话
    // 旧格式：snapshot 无 user_message，用 request 作为第一条兜底（向后兼容）
    const hasUserMessages = snapshot.some((e) => e.event_type === "user_message");
    const msgs = hasUserMessages
        ? []
        : [{ role: "user", type: "text", content: request }];
    for (const event of snapshot) {
        const last = msgs[msgs.length - 1];
        if (event.event_type === "user_message") {
            msgs.push({ role: "user", type: "text", content: event.content });
        }
        else if (event.event_type === "token") {
            if (last?.role === "assistant" && last.type === "text") {
                last.content += event.content;
            }
            else {
                msgs.push({ role: "assistant", type: "text", content: event.content });
            }
        }
        else if (event.event_type === "thinking") {
            if (last?.role === "assistant" && last.type === "thinking") {
                last.content += event.content;
            }
            else {
                msgs.push({ role: "assistant", type: "thinking", content: event.content });
            }
        }
        else if (event.event_type === "tool_call") {
            msgs.push({ role: "assistant", type: "tool_call", content: event.content });
        }
        else if (event.event_type === "tool_result") {
            msgs.push({ role: "assistant", type: "tool_result", content: event.content });
        }
    }
    return msgs;
}
/** 向消息列表追加流式/离散事件 */
function appendMessageEvent(prev, type, text, streaming = false) {
    const last = prev[prev.length - 1];
    if (streaming && last?.role === "assistant" && last.type === type) {
        return [...prev.slice(0, -1), { ...last, content: last.content + text, isStreaming: true }];
    }
    if (type === "text" || type === "thinking") {
        return [...prev, { role: "assistant", type, content: text, isStreaming: streaming }];
    }
    return [...prev, { role: "assistant", type, content: text }];
}
function markAllStreamingDone(prev) {
    return prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
}
function emptyRuntime(messages = []) {
    return { messages, activeTurnId: null, isLoading: false, closeStream: null };
}
// ── 消息块渲染 ──────────────────────────────────────────────────────────────
function ThinkingBlock({ content, isStreaming }) {
    const [open, setOpen] = useState(!!isStreaming);
    useEffect(() => { if (isStreaming)
        setOpen(true); }, [isStreaming]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (!isStreaming)
        setOpen(false); }, [isStreaming]);
    return (_jsxs("div", { className: "max-w-[85%] text-xs", children: [_jsxs("button", { onClick: () => setOpen((v) => !v), className: "flex items-center gap-1.5 text-ink-400 hover:text-amber-600 transition-colors mb-1.5", children: [_jsx("svg", { className: `w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5l7 7-7 7" }) }), _jsx("span", { className: "italic font-medium", children: isStreaming ? "正在思考…" : "思考过程" }), isStreaming && _jsx("span", { className: "inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" })] }), open && (_jsx("div", { className: "bg-amber-50/80 border border-amber-200/70 rounded-2xl px-3.5 py-2.5 text-ink-500 italic whitespace-pre-wrap break-words leading-relaxed shadow-soft", children: content }))] }));
}
function ToolCallBlock({ content }) {
    const [open, setOpen] = useState(true);
    let name = "";
    let inputText = "";
    try {
        const p = JSON.parse(content);
        name = p.name;
        inputText = JSON.stringify(p.input, null, 2);
    }
    catch {
        inputText = content;
    }
    return (_jsxs("div", { className: "max-w-[85%] text-xs", children: [_jsxs("button", { onClick: () => setOpen((v) => !v), className: "flex items-center gap-1.5 text-brand-500 hover:text-brand-700 transition-colors mb-1.5", children: [_jsx("svg", { className: `w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5l7 7-7 7" }) }), _jsxs("svg", { className: "w-3 h-3", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: [_jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" }), _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z" })] }), _jsx("span", { className: "font-mono font-medium text-brand-600", children: name || "工具调用" })] }), open && _jsx("pre", { className: "bg-brand-50/60 border border-brand-100 rounded-2xl px-3.5 py-2.5 text-ink-600 overflow-x-auto shadow-soft", children: inputText })] }));
}
function ToolResultBlock({ content }) {
    const [open, setOpen] = useState(false);
    let name = "";
    let outputText = "";
    let isError = false;
    try {
        const p = JSON.parse(content);
        name = p.name;
        outputText = p.output;
        isError = !!p.isError;
    }
    catch {
        outputText = content;
    }
    return (_jsxs("div", { className: "max-w-[85%] text-xs", children: [_jsxs("button", { onClick: () => setOpen((v) => !v), className: `flex items-center gap-1.5 transition-colors mb-1.5 ${isError ? "text-rose-400 hover:text-rose-600" : "text-emerald-500 hover:text-emerald-700"}`, children: [_jsx("svg", { className: `w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5l7 7-7 7" }) }), isError
                        ? _jsx("svg", { className: "w-3 h-3", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M6 18L18 6M6 6l12 12" }) })
                        : _jsx("svg", { className: "w-3 h-3", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M5 13l4 4L19 7" }) }), _jsx("span", { className: `font-mono font-medium ${isError ? "text-rose-500" : "text-emerald-600"}`, children: name ? `${name} 结果` : "执行结果" })] }), open && (_jsx("pre", { className: `border rounded-2xl px-3.5 py-2.5 overflow-x-auto shadow-soft ${isError ? "bg-rose-50/80 border-rose-100 text-rose-600" : "bg-emerald-50/80 border-emerald-100 text-ink-600"}`, children: outputText }))] }));
}
function PiAvatar() {
    return (_jsx("div", { className: "w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-xs font-semibold shrink-0 mt-0.5 shadow-sm", children: "\u03C0" }));
}
function MessageBubble({ msg }) {
    if (msg.role === "user") {
        return (_jsx("div", { className: "flex justify-end", children: _jsx("div", { className: "max-w-[78%] rounded-2.5xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft", children: msg.content }) }));
    }
    if (msg.type === "thinking") {
        return (_jsxs("div", { className: "flex gap-3 justify-start", children: [_jsx(PiAvatar, {}), _jsx(ThinkingBlock, { content: msg.content, isStreaming: msg.isStreaming })] }));
    }
    if (msg.type === "tool_call") {
        return (_jsxs("div", { className: "flex gap-3 justify-start", children: [_jsx(PiAvatar, {}), _jsx(ToolCallBlock, { content: msg.content })] }));
    }
    if (msg.type === "tool_result") {
        return (_jsxs("div", { className: "flex gap-3 justify-start", children: [_jsx(PiAvatar, {}), _jsx(ToolResultBlock, { content: msg.content })] }));
    }
    return (_jsxs("div", { className: "flex gap-3 justify-start", children: [_jsx(PiAvatar, {}), _jsxs("div", { className: "max-w-[78%] rounded-2.5xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-white/90 backdrop-blur-sm border border-ink-200/60 text-ink-900 shadow-soft", children: [msg.content, msg.isStreaming && _jsx("span", { className: "inline-block w-0.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle rounded-full" })] })] }));
}
function SkillScopeBadge({ scope }) {
    const isUser = scope === "user";
    return (_jsx("span", { className: `ui-chip ${isUser ? "bg-emerald-50 text-emerald-700 border-emerald-200/80" : "bg-sky-50 text-sky-700 border-sky-200/80"}`, children: isUser ? "我的" : "系统" }));
}
function SkillOptionGroup({ label, scope, skills }) {
    if (skills.length === 0)
        return null;
    return (_jsx("optgroup", { label: label, children: skills.map((s) => {
            const value = toSkillRef(scope, s.name);
            return _jsx("option", { value: value, title: s.description, children: s.name }, value);
        }) }));
}
// ── 主页面 ───────────────────────────────────────────────────────────────────
export default function ChatPage() {
    const [userId, setUserId] = useState(() => localStorage.getItem("pi_user_id") ?? "");
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [skills, setSkills] = useState([]);
    const [selectedSkillRef, setSelectedSkillRef] = useState("");
    const [sessions, setSessions] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [showSkillCreator, setShowSkillCreator] = useState(false);
    const [showMcpPanel, setShowMcpPanel] = useState(false);
    /** 当前可见 session，用于 UI 与 loading 状态隔离 */
    const [currentSessionId, setCurrentSessionId] = useState(() => localStorage.getItem("pi_session_id"));
    /** 触发侧栏等依赖 sessionRuntime 的 UI 刷新 */
    const [runtimeTick, setRuntimeTick] = useState(0);
    const notifyRuntimeChange = useCallback(() => setRuntimeTick((t) => t + 1), []);
    const isSessionGenerating = useCallback((sid) => (sessionRuntimeRef.current.get(sid)?.isLoading ?? false), []);
    // session_id：当前 chat 窗口的 session，null 表示尚未创建
    const sessionIdRef = useRef(null);
    const activeTurnIdRef = useRef(null);
    const closeStreamRef = useRef(null);
    const messagesRef = useRef([]);
    const isLoadingRef = useRef(false);
    const sessionRuntimeRef = useRef(new Map());
    const attachTurnStreamRef = useRef(() => { });
    const bottomRef = useRef(null);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
    // 页面加载时从 localStorage 恢复上次会话
    useEffect(() => {
        const savedSessionId = localStorage.getItem("pi_session_id");
        const savedUserId = localStorage.getItem("pi_user_id");
        if (!savedSessionId || !savedUserId)
            return;
        sessionIdRef.current = savedSessionId;
        setCurrentSessionId(savedSessionId);
        getSessionDetail(savedSessionId).then(async (detail) => {
            if (!detail) {
                localStorage.removeItem("pi_session_id");
                sessionIdRef.current = null;
                return;
            }
            const msgs = buildMessagesFromSnapshot(detail.request, detail.events_snapshot);
            setMessages(msgs);
            sessionRuntimeRef.current.set(savedSessionId, emptyRuntime(msgs));
            const activeTurnId = await getActiveTurn(savedSessionId);
            if (activeTurnId) {
                attachTurnStreamRef.current(savedSessionId, activeTurnId, "0");
            }
        }).catch(() => {
            localStorage.removeItem("pi_session_id");
            sessionIdRef.current = null;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const loadSkills = useCallback(async (uid) => {
        try {
            const list = await skillsApi.listForChat(uid);
            setSkills(list);
            setSelectedSkillRef((prev) => prev && list.some((s) => toSkillRef(s.scope ?? "system", s.name) === prev) ? prev : "");
        }
        catch {
            setSkills([]);
        }
    }, []);
    useEffect(() => {
        loadSkills(userId);
    }, [userId, loadSkills]);
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);
    const loadSessions = useCallback(async (uid) => {
        if (!uid.trim()) {
            setSessions([]);
            return;
        }
        const list = await getRecentSessions(uid);
        setSessions(list);
    }, []);
    useEffect(() => {
        if (userId.trim())
            loadSessions(userId);
    }, [userId, loadSessions]);
    /** 将顶部/输入区的 loading 与当前可见 session 对齐（会话间隔离） */
    const syncVisibleSessionState = useCallback((sid) => {
        if (!sid) {
            setIsLoading(false);
            activeTurnIdRef.current = null;
            closeStreamRef.current = null;
            return;
        }
        const runtime = sessionRuntimeRef.current.get(sid);
        setIsLoading(runtime?.isLoading ?? false);
        activeTurnIdRef.current = runtime?.activeTurnId ?? null;
        closeStreamRef.current = runtime?.closeStream ?? null;
    }, []);
    /** 切换离开当前会话时，保留 SSE 与消息缓存在内存中（不关闭后端 session） */
    const persistCurrentSession = useCallback(() => {
        const sid = sessionIdRef.current;
        if (!sid)
            return;
        sessionRuntimeRef.current.set(sid, {
            messages: messagesRef.current,
            activeTurnId: activeTurnIdRef.current,
            isLoading: isLoadingRef.current,
            closeStream: closeStreamRef.current,
        });
        closeStreamRef.current = null;
        activeTurnIdRef.current = null;
    }, []);
    const updateSessionMessages = useCallback((sid, updater) => {
        const cached = sessionRuntimeRef.current.get(sid);
        const base = sid === sessionIdRef.current ? messagesRef.current : (cached?.messages ?? []);
        const next = updater(base);
        sessionRuntimeRef.current.set(sid, {
            ...(cached ?? emptyRuntime()),
            messages: next,
        });
        if (sid === sessionIdRef.current)
            setMessages(next);
    }, []);
    const attachTurnStream = useCallback((sid, turnId, lastSeq = "0") => {
        const onDone = () => {
            const runtime = sessionRuntimeRef.current.get(sid) ?? emptyRuntime();
            const doneMessages = markAllStreamingDone(runtime.messages);
            sessionRuntimeRef.current.set(sid, {
                ...runtime,
                messages: doneMessages,
                activeTurnId: null,
                isLoading: false,
                closeStream: null,
            });
            if (sessionIdRef.current === sid) {
                activeTurnIdRef.current = null;
                closeStreamRef.current = null;
                setIsLoading(false);
                setMessages(doneMessages);
            }
            notifyRuntimeChange();
            loadSessions(userId);
        };
        const onError = (msg) => {
            const runtime = sessionRuntimeRef.current.get(sid) ?? emptyRuntime();
            sessionRuntimeRef.current.set(sid, {
                ...runtime,
                activeTurnId: null,
                isLoading: false,
                closeStream: null,
            });
            if (sessionIdRef.current === sid) {
                activeTurnIdRef.current = null;
                closeStreamRef.current = null;
                setIsLoading(false);
                setError(msg);
            }
            notifyRuntimeChange();
        };
        const closeFn = streamTurn(sid, turnId, (ev) => {
            if (ev.event === "token") {
                updateSessionMessages(sid, (prev) => appendMessageEvent(prev, "text", ev.data, true));
            }
            else if (ev.event === "thinking") {
                updateSessionMessages(sid, (prev) => appendMessageEvent(prev, "thinking", ev.data, true));
            }
            else if (ev.event === "tool_call") {
                updateSessionMessages(sid, (prev) => appendMessageEvent(prev, "tool_call", ev.data));
            }
            else if (ev.event === "tool_result") {
                updateSessionMessages(sid, (prev) => appendMessageEvent(prev, "tool_result", ev.data));
            }
        }, onDone, onError, lastSeq);
        const runtime = sessionRuntimeRef.current.get(sid) ?? emptyRuntime(messagesRef.current);
        sessionRuntimeRef.current.set(sid, {
            ...runtime,
            activeTurnId: turnId,
            isLoading: true,
            closeStream: closeFn,
        });
        if (sessionIdRef.current === sid) {
            activeTurnIdRef.current = turnId;
            closeStreamRef.current = closeFn;
            setIsLoading(true);
        }
        notifyRuntimeChange();
    }, [loadSessions, updateSessionMessages, userId, notifyRuntimeChange]);
    useEffect(() => {
        attachTurnStreamRef.current = attachTurnStream;
    }, [attachTurnStream]);
    /** 点击历史侧边栏，加载某个 session 的消息记录 */
    const switchToSession = useCallback(async (s) => {
        if (sessionIdRef.current === s.session_id)
            return;
        persistCurrentSession();
        setError("");
        sessionIdRef.current = s.session_id;
        setCurrentSessionId(s.session_id);
        localStorage.setItem("pi_session_id", s.session_id);
        const cached = sessionRuntimeRef.current.get(s.session_id);
        if (cached) {
            setMessages(cached.messages);
            syncVisibleSessionState(s.session_id);
            return;
        }
        // 无缓存时先清掉上一会话的 loading 展示，再异步加载
        syncVisibleSessionState(s.session_id);
        setMessages([]);
        const detail = await getSessionDetail(s.session_id);
        const msgs = detail ? buildMessagesFromSnapshot(detail.request, detail.events_snapshot) : [];
        setMessages(msgs);
        const activeTurnId = await getActiveTurn(s.session_id);
        if (activeTurnId) {
            sessionRuntimeRef.current.set(s.session_id, { ...emptyRuntime(msgs), isLoading: true });
            notifyRuntimeChange();
            attachTurnStream(s.session_id, activeTurnId, "0");
            return;
        }
        sessionRuntimeRef.current.set(s.session_id, emptyRuntime(msgs));
        syncVisibleSessionState(s.session_id);
    }, [persistCurrentSession, attachTurnStream, syncVisibleSessionState, notifyRuntimeChange]);
    /** 开始新 chat（清空当前视图，不关闭后台 session） */
    const startNewChat = useCallback(() => {
        persistCurrentSession();
        sessionIdRef.current = null;
        setCurrentSessionId(null);
        localStorage.removeItem("pi_session_id");
        setMessages([]);
        syncVisibleSessionState(null);
        setError("");
    }, [persistCurrentSession, syncVisibleSessionState]);
    const interrupt = useCallback(async () => {
        const sessionId = sessionIdRef.current;
        const turnId = activeTurnIdRef.current;
        if (!sessionId || !turnId || !isLoading)
            return;
        const runtime = sessionRuntimeRef.current.get(sessionId);
        if (runtime?.closeStream)
            runtime.closeStream();
        closeStreamRef.current = null;
        activeTurnIdRef.current = null;
        const interruptedMessages = markAllStreamingDone(messagesRef.current);
        sessionRuntimeRef.current.set(sessionId, {
            ...(runtime ?? emptyRuntime()),
            messages: interruptedMessages,
            activeTurnId: null,
            isLoading: false,
            closeStream: null,
        });
        setMessages(interruptedMessages);
        setIsLoading(false);
        notifyRuntimeChange();
        try {
            await cancelTurn(sessionId, turnId);
            if (userId.trim())
                loadSessions(userId);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "中断失败");
        }
    }, [isLoading, userId, loadSessions, notifyRuntimeChange]);
    const send = useCallback(async () => {
        const trimmed = input.trim();
        if (!trimmed || isLoading)
            return;
        if (!userId.trim()) {
            setError("请先填写用户 ID");
            return;
        }
        localStorage.setItem("pi_user_id", userId);
        setError("");
        setInput("");
        setIsLoading(true);
        setMessages((prev) => {
            const next = [...prev, { role: "user", type: "text", content: trimmed }];
            messagesRef.current = next;
            return next;
        });
        const turnId = crypto.randomUUID();
        const skillIds = selectedSkillRef ? [selectedSkillRef] : [];
        try {
            let sessionId = sessionIdRef.current;
            if (!sessionId) {
                const resp = await createSession(userId, trimmed, turnId, skillIds);
                sessionId = resp.session_id;
                sessionIdRef.current = sessionId;
                setCurrentSessionId(sessionId);
                localStorage.setItem("pi_session_id", sessionId);
                sessionRuntimeRef.current.set(sessionId, emptyRuntime(messagesRef.current));
            }
            else {
                await sendMessage(sessionId, trimmed, turnId, skillIds);
            }
            attachTurnStream(sessionId, turnId);
        }
        catch (e) {
            activeTurnIdRef.current = null;
            setError(e instanceof Error ? e.message : "请求失败");
            setIsLoading(false);
        }
    }, [input, userId, isLoading, selectedSkillRef, attachTurnStream]);
    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    };
    const handleUserIdChange = (newId) => {
        setUserId(newId);
        startNewChat();
        if (newId.trim())
            loadSessions(newId);
    };
    return (_jsxs("div", { className: "flex h-full", children: [showHistory && (_jsxs("div", { className: "w-72 border-r border-ink-200/60 bg-white/70 backdrop-blur-xl flex flex-col shrink-0 shadow-soft", children: [_jsxs("div", { className: "px-4 py-3 border-b border-ink-200/60 flex items-center justify-between", children: [_jsx("span", { className: "text-sm font-semibold text-ink-700", children: "\u5386\u53F2\u5BF9\u8BDD" }), _jsx("button", { onClick: () => setShowHistory(false), className: "w-7 h-7 flex items-center justify-center rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-colors", children: "\u00D7" })] }), _jsx("div", { className: "flex-1 overflow-y-auto scrollbar-thin", children: sessions.length === 0 ? (_jsx("p", { className: "text-xs text-ink-400 text-center mt-12 px-4", children: "\u6682\u65E0\u5386\u53F2\u5BF9\u8BDD" })) : (sessions.map((s) => (_jsxs("button", { onClick: () => switchToSession(s), className: `w-full text-left px-4 py-3 border-b border-ink-100/80 transition-all duration-200 ${s.session_id === currentSessionId
                                ? "bg-brand-50/80 border-l-[3px] border-l-brand-600"
                                : "hover:bg-white/80 border-l-[3px] border-l-transparent"}`, children: [_jsx("p", { className: "text-sm text-ink-800 truncate leading-snug", children: s.request }), _jsxs("p", { className: "text-xs text-ink-400 mt-1 flex items-center gap-2", children: [_jsx("span", { className: `inline-block w-1.5 h-1.5 rounded-full ${isSessionGenerating(s.session_id) ? "bg-amber-400 animate-pulse" :
                                                s.status === "COMPLETED" ? "bg-emerald-400" :
                                                    s.status === "RUNNING" ? "bg-amber-400" :
                                                        s.status === "FAILED" ? "bg-rose-400" : "bg-ink-300"}` }), _jsx("span", { children: new Date(s.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) })] })] }, `${s.session_id}-${runtimeTick}`)))) })] })), _jsxs("div", { className: "flex flex-col flex-1 min-w-0", children: [_jsxs("div", { className: "bg-white/75 backdrop-blur-xl border-b border-ink-200/60 px-4 py-2.5 flex items-center gap-3 flex-wrap shadow-sm", children: [_jsxs("div", { className: "flex items-center gap-0.5 p-1 rounded-xl bg-ink-100/70", children: [_jsx("button", { onClick: () => { setShowHistory((v) => !v); if (!showHistory && userId.trim())
                                            loadSessions(userId); }, title: "\u5386\u53F2\u5BF9\u8BDD", className: `ui-icon-btn ${showHistory ? "ui-icon-btn-active" : ""}`, children: _jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.8, d: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" }) }) }), _jsx("button", { onClick: startNewChat, title: "\u65B0\u5BF9\u8BDD", className: "ui-icon-btn", children: _jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.8, d: "M12 4v16m8-8H4" }) }) })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("label", { className: "text-xs font-medium text-ink-400 whitespace-nowrap", children: "\u7528\u6237" }), _jsx("input", { value: userId, onChange: (e) => handleUserIdChange(e.target.value), placeholder: "alice", className: "ui-field w-28" })] }), _jsx("div", { className: "hidden sm:block w-px h-5 bg-ink-200/80" }), _jsxs("div", { className: "flex items-center gap-2 min-w-0", children: [_jsx("label", { className: "text-xs font-medium text-ink-400 whitespace-nowrap", children: "Skill" }), _jsxs("select", { value: selectedSkillRef, onChange: (e) => setSelectedSkillRef(e.target.value), className: "ui-field max-w-[180px]", children: [_jsx("option", { value: "", children: "\u9ED8\u8BA4\uFF08\u4E0D\u6307\u5B9A\uFF09" }), _jsx(SkillOptionGroup, { label: "\u7CFB\u7EDF Skill", scope: "system", skills: skills.filter((s) => (s.scope ?? "system") === "system") }), _jsx(SkillOptionGroup, { label: "\u6211\u7684 Skill", scope: "user", skills: skills.filter((s) => s.scope === "user") })] }), selectedSkillRef && (() => {
                                        const item = skills.find((s) => toSkillRef(s.scope ?? "system", s.name) === selectedSkillRef);
                                        if (!item)
                                            return null;
                                        return (_jsxs("span", { className: "hidden lg:flex text-xs text-brand-600 items-center gap-1.5 max-w-[200px] truncate", children: [_jsx(SkillScopeBadge, { scope: item.scope ?? "system" }), _jsx("span", { className: "truncate text-ink-500", children: item.description })] }));
                                    })()] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => {
                                            if (!userId.trim()) {
                                                setError("请先填写用户 ID");
                                                return;
                                            }
                                            setShowMcpPanel(true);
                                        }, title: "\u7BA1\u7406 MCP", className: "ui-chip bg-sky-50 text-sky-700 border-sky-200/80 hover:bg-sky-100", children: "MCP" }), _jsx("button", { onClick: () => {
                                            if (!userId.trim()) {
                                                setError("请先填写用户 ID");
                                                return;
                                            }
                                            setShowSkillCreator(true);
                                        }, title: "\u5BF9\u8BDD\u521B\u5EFA\u6211\u7684 Skill", className: "ui-chip bg-emerald-50 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100", children: "+ Skill" })] }), isLoading && (_jsxs("div", { className: "ml-auto flex items-center gap-2", children: [_jsxs("span", { className: "text-xs text-brand-600 font-medium flex items-center gap-1.5", children: [_jsx("span", { className: "inline-block w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" }), "Pi \u6B63\u5728\u6267\u884C\u2026"] }), _jsx("button", { onClick: interrupt, className: "ui-chip bg-amber-50 text-amber-700 border-amber-200/80 hover:bg-amber-100", children: "\u4E2D\u65AD" })] })), error && (_jsx("span", { className: `text-xs text-rose-500 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-100 ${isLoading ? "" : "ml-auto"}`, children: error }))] }), _jsx("div", { className: "flex-1 overflow-y-auto scrollbar-thin", children: _jsxs("div", { className: "max-w-3xl mx-auto w-full px-5 py-6 space-y-5", children: [messages.length === 0 && (_jsxs("div", { className: "text-center mt-24 px-4", children: [_jsx("div", { className: "w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-2xl font-bold shadow-soft mb-4", children: "\u03C0" }), _jsx("p", { className: "text-ink-700 font-medium", children: "\u5F00\u59CB\u4E0E Pi Agent \u5BF9\u8BDD" }), _jsx("p", { className: "text-sm text-ink-400 mt-2 leading-relaxed", children: "\u9009\u62E9 Skill\uFF08\u53EF\u9009\uFF09\uFF0C\u53D1\u9001\u6D88\u606F\uFF0CPi \u5C06\u4E3A\u4F60\u6267\u884C\u4EFB\u52A1" })] })), messages.map((msg, i) => _jsx(MessageBubble, { msg: msg }, i)), _jsx("div", { ref: bottomRef })] }) }), _jsx("div", { className: "border-t border-ink-200/60 bg-white/80 backdrop-blur-xl px-4 py-4", children: _jsx("div", { className: "max-w-3xl mx-auto", children: _jsxs("div", { className: "flex gap-3 items-end rounded-2xl border border-ink-200/80 bg-white/90 p-2 shadow-soft focus-within:ring-2 focus-within:ring-brand-500/20 focus-within:border-brand-300 transition-all duration-200", children: [_jsx("textarea", { value: input, onChange: (e) => setInput(e.target.value), onKeyDown: handleKeyDown, placeholder: "\u8F93\u5165\u4F60\u7684\u8BF7\u6C42\u2026 (Enter \u53D1\u9001\uFF0CShift+Enter \u6362\u884C)", rows: 2, className: "flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none" }), isLoading ? (_jsx("button", { onClick: interrupt, className: "ui-btn-danger shrink-0", children: "\u4E2D\u65AD" })) : (_jsx("button", { onClick: send, disabled: !input.trim(), className: "ui-btn-primary shrink-0", children: "\u53D1\u9001" }))] }) }) })] }), showMcpPanel && userId.trim() && (_jsx(UserMcpPanel, { userId: userId.trim(), onClose: () => setShowMcpPanel(false) })), showSkillCreator && userId.trim() && (_jsx(SkillCreatorChat, { userId: userId.trim(), scope: "user", onClose: () => setShowSkillCreator(false), onPublished: (skill) => {
                    loadSkills(userId);
                    setSelectedSkillRef(toSkillRef("user", skill.name));
                    setError("");
                } }))] }));
}
