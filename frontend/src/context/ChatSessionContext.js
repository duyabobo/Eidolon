import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useState, useRef, useEffect, useCallback, } from "react";
import { createSession, sendMessage, cancelTurn, streamTurn, getRecentSessions, getSessionDetail, getActiveTurn, } from "../api/session";
import { skillsApi, toSkillRef } from "../api/skills";
function emptyRuntime(messages = []) {
    return { messages, activeTurnId: null, isLoading: false, closeStream: null };
}
export function buildMessagesFromSnapshot(request, snapshot) {
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
const ChatSessionContext = createContext(null);
export function useChatSession() {
    const ctx = useContext(ChatSessionContext);
    if (!ctx)
        throw new Error("useChatSession must be used within ChatSessionProvider");
    return ctx;
}
export function ChatSessionProvider({ children }) {
    const [userId, setUserIdState] = useState(() => localStorage.getItem("pi_user_id") ?? "");
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [skills, setSkills] = useState([]);
    const [selectedSkillRef, setSelectedSkillRef] = useState("");
    const [sessions, setSessions] = useState([]);
    const [currentSessionId, setCurrentSessionId] = useState(() => localStorage.getItem("pi_session_id"));
    const [runtimeTick, setRuntimeTick] = useState(0);
    const sessionIdRef = useRef(null);
    const activeTurnIdRef = useRef(null);
    const closeStreamRef = useRef(null);
    const messagesRef = useRef([]);
    const isLoadingRef = useRef(false);
    const sessionRuntimeRef = useRef(new Map());
    const attachTurnStreamRef = useRef(() => { });
    const restoredRef = useRef(false);
    const notifyRuntimeChange = useCallback(() => setRuntimeTick((t) => t + 1), []);
    const isSessionGenerating = useCallback((sid) => (sessionRuntimeRef.current.get(sid)?.isLoading ?? false), []);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
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
        sessionRuntimeRef.current.set(sid, { ...(cached ?? emptyRuntime()), messages: next });
        if (sid === sessionIdRef.current)
            setMessages(next);
    }, []);
    const loadSkills = useCallback(async () => {
        try {
            const list = await skillsApi.listForChat(userId);
            setSkills(list);
            setSelectedSkillRef((prev) => prev && list.some((s) => toSkillRef(s.scope ?? "system", s.name) === prev) ? prev : "");
        }
        catch {
            setSkills([]);
        }
    }, [userId]);
    const loadSessions = useCallback(async () => {
        if (!userId.trim()) {
            setSessions([]);
            return;
        }
        const list = await getRecentSessions(userId);
        setSessions(list);
    }, [userId]);
    useEffect(() => { loadSkills(); }, [loadSkills]);
    useEffect(() => { loadSessions(); }, [loadSessions]);
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
            loadSessions();
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
    }, [loadSessions, updateSessionMessages, notifyRuntimeChange]);
    useEffect(() => {
        attachTurnStreamRef.current = attachTurnStream;
    }, [attachTurnStream]);
    const restoreSession = useCallback(async (savedSessionId) => {
        sessionIdRef.current = savedSessionId;
        setCurrentSessionId(savedSessionId);
        const detail = await getSessionDetail(savedSessionId);
        if (!detail) {
            localStorage.removeItem("pi_session_id");
            sessionIdRef.current = null;
            setCurrentSessionId(null);
            return;
        }
        const msgs = buildMessagesFromSnapshot(detail.request, detail.events_snapshot);
        setMessages(msgs);
        sessionRuntimeRef.current.set(savedSessionId, emptyRuntime(msgs));
        const activeTurnId = await getActiveTurn(savedSessionId);
        if (activeTurnId) {
            attachTurnStreamRef.current(savedSessionId, activeTurnId, "0");
        }
    }, []);
    useEffect(() => {
        if (restoredRef.current)
            return;
        restoredRef.current = true;
        const savedSessionId = localStorage.getItem("pi_session_id");
        const savedUserId = localStorage.getItem("pi_user_id");
        if (!savedSessionId || !savedUserId)
            return;
        restoreSession(savedSessionId).catch(() => {
            localStorage.removeItem("pi_session_id");
            sessionIdRef.current = null;
        });
    }, [restoreSession]);
    const startNewChat = useCallback(() => {
        persistCurrentSession();
        sessionIdRef.current = null;
        setCurrentSessionId(null);
        localStorage.removeItem("pi_session_id");
        setMessages([]);
        syncVisibleSessionState(null);
        setError("");
        setSelectedSkillRef("");
    }, [persistCurrentSession, syncVisibleSessionState]);
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
    const setUserId = useCallback((newId) => {
        setUserIdState(newId);
        localStorage.setItem("pi_user_id", newId);
    }, []);
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
            loadSessions();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "中断失败");
        }
    }, [isLoading, loadSessions, notifyRuntimeChange]);
    const send = useCallback(async (text) => {
        const trimmed = text.trim();
        if (!trimmed || isLoading)
            return;
        if (!userId.trim()) {
            setError("请先在「历史」页设置用户 ID");
            return;
        }
        setError("");
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
    }, [userId, isLoading, selectedSkillRef, attachTurnStream]);
    const value = {
        userId,
        setUserId,
        messages,
        isLoading,
        error,
        setError,
        skills,
        selectedSkillRef,
        setSelectedSkillRef,
        sessions,
        currentSessionId,
        runtimeTick,
        loadSessions,
        loadSkills,
        startNewChat,
        switchToSession,
        interrupt,
        send,
        isSessionGenerating,
    };
    return (_jsx(ChatSessionContext.Provider, { value: value, children: children }));
}
