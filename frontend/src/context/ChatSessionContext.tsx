import {
  createContext, useContext, useState, useRef, useEffect, useCallback, ReactNode,
} from "react";
import {
  createSession, sendMessage, cancelTurn,
  streamTurn, getRecentSessions, getSessionDetail, getActiveTurn,
  SessionSummary,
} from "../api/session";
import { skillsApi, Skill, toSkillRef } from "../api/skills";

export type MessageType = "text" | "thinking" | "tool_call" | "tool_result";

export interface Message {
  role: "user" | "assistant";
  type: MessageType;
  content: string;
  isStreaming?: boolean;
  /** 步骤开始时间（ms），流式事件到达时记录 */
  startedAt?: number;
  /** 步骤结束时间（ms） */
  endedAt?: number;
}

interface SessionRuntime {
  messages: Message[];
  activeTurnId: string | null;
  isLoading: boolean;
  closeStream: (() => void) | null;
}

function emptyRuntime(messages: Message[] = []): SessionRuntime {
  return { messages, activeTurnId: null, isLoading: false, closeStream: null };
}

export function buildMessagesFromSnapshot(
  request: string,
  snapshot: Array<{ event_type: string; content: string; ts?: number | string }>,
): Message[] {
  const hasUserMessages = snapshot.some((e) => e.event_type === "user_message");
  let msgs: Message[] = hasUserMessages
    ? []
    : [{ role: "user", type: "text", content: request }];

  let clock = Date.now();

  const parseTs = (event: { ts?: number | string }): number => {
    if (event.ts != null) {
      const n = typeof event.ts === "number" ? event.ts : Number(event.ts);
      if (Number.isFinite(n)) {
        clock = Math.max(clock, n);
        return n;
      }
    }
    // 旧 snapshot 无 ts：按事件顺序递增，避免耗时全为 0
    clock += 100;
    return clock;
  };

  const closeLastAssistantAt = (list: Message[], endTs: number): Message[] => {
    if (list.length === 0) return list;
    const last = list[list.length - 1];
    if (last.role !== "assistant" || last.endedAt != null) return list;
    return [...list.slice(0, -1), { ...last, endedAt: endTs }];
  };

  for (const event of snapshot) {
    const ts = parseTs(event);
    clock = ts;
    const content = event.content ?? "";
    const last = msgs[msgs.length - 1];

    if (event.event_type === "user_message") {
      msgs.push({ role: "user", type: "text", content, startedAt: ts, endedAt: ts });
      continue;
    }

    if (event.event_type === "token") {
      if (last?.role === "assistant" && last.type === "text") {
        msgs[msgs.length - 1] = { ...last, content: last.content + content, endedAt: ts };
      } else {
        msgs = [
          ...closeLastAssistantAt(msgs, ts),
          { role: "assistant", type: "text", content, startedAt: ts, endedAt: ts },
        ];
      }
      continue;
    }

    if (event.event_type === "thinking") {
      if (last?.role === "assistant" && last.type === "thinking") {
        msgs[msgs.length - 1] = { ...last, content: last.content + content, endedAt: ts };
      } else {
        msgs = [
          ...closeLastAssistantAt(msgs, ts),
          { role: "assistant", type: "thinking", content, startedAt: ts, endedAt: ts },
        ];
      }
      continue;
    }

    if (event.event_type === "tool_call") {
      msgs = [
        ...closeLastAssistantAt(msgs, ts),
        { role: "assistant", type: "tool_call", content, startedAt: ts },
      ];
      continue;
    }

    if (event.event_type === "tool_result") {
      if (last?.role === "assistant" && last.type === "tool_call" && last.endedAt == null) {
        msgs[msgs.length - 1] = { ...last, endedAt: ts };
      }
      msgs.push({ role: "assistant", type: "tool_result", content, startedAt: ts, endedAt: ts });
    }
  }

  const sealed = closeLastAssistantAt(msgs, clock);
  return sealed;
}

function closeLastAssistantStep(prev: Message[]): Message[] {
  if (prev.length === 0) return prev;
  const last = prev[prev.length - 1];
  if (last.role !== "assistant" || last.endedAt) return prev;
  const now = Date.now();
  return [...prev.slice(0, -1), { ...last, endedAt: now, isStreaming: false }];
}

function appendMessageEvent(prev: Message[], type: MessageType, text: string, streaming = false): Message[] {
  const now = Date.now();
  const last = prev[prev.length - 1];
  if (streaming && last?.role === "assistant" && last.type === type) {
    return [...prev.slice(0, -1), {
      ...last,
      content: last.content + text,
      isStreaming: true,
      startedAt: last.startedAt ?? now,
    }];
  }

  const closed = closeLastAssistantStep(prev);
  if (type === "text" || type === "thinking") {
    return [...closed, { role: "assistant", type, content: text, isStreaming: streaming, startedAt: now }];
  }
  return [...closed, { role: "assistant", type, content: text, startedAt: now }];
}

function markAllStreamingDone(prev: Message[]): Message[] {
  const now = Date.now();
  return prev.map((m, i) => {
    const isLast = i === prev.length - 1;
    let next = { ...m };
    if (m.isStreaming) {
      next = { ...next, isStreaming: false, endedAt: m.endedAt ?? now };
    } else if (isLast && m.role === "assistant" && !m.endedAt && m.startedAt) {
      next = { ...next, endedAt: now };
    }
    return next;
  });
}

interface ChatSessionContextValue {
  userId: string;
  setUserId: (id: string) => void;
  messages: Message[];
  isLoading: boolean;
  error: string;
  setError: (msg: string) => void;
  skills: Skill[];
  selectedSkillRef: string;
  setSelectedSkillRef: (ref: string) => void;
  sessions: SessionSummary[];
  currentSessionId: string | null;
  runtimeTick: number;
  loadSessions: () => void;
  loadSkills: () => void;
  startNewChat: () => void;
  switchToSession: (s: SessionSummary) => Promise<void>;
  interrupt: () => Promise<void>;
  send: (text: string) => Promise<void>;
  isSessionGenerating: (sid: string) => boolean;
}

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

export function useChatSession() {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSession must be used within ChatSessionProvider");
  return ctx;
}

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState(() => localStorage.getItem("pi_user_id") ?? "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkillRef, setSelectedSkillRef] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    () => localStorage.getItem("pi_session_id"),
  );
  const [runtimeTick, setRuntimeTick] = useState(0);

  const sessionIdRef = useRef<string | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const closeStreamRef = useRef<(() => void) | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const isLoadingRef = useRef(false);
  const sessionRuntimeRef = useRef<Map<string, SessionRuntime>>(new Map());
  const attachTurnStreamRef = useRef<(sid: string, turnId: string, lastSeq?: string) => void>(() => {});
  const restoredRef = useRef(false);

  const notifyRuntimeChange = useCallback(() => setRuntimeTick((t) => t + 1), []);

  const isSessionGenerating = useCallback((sid: string) => (
    sessionRuntimeRef.current.get(sid)?.isLoading ?? false
  ), []);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  const syncVisibleSessionState = useCallback((sid: string | null) => {
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
    if (!sid) return;
    sessionRuntimeRef.current.set(sid, {
      messages: messagesRef.current,
      activeTurnId: activeTurnIdRef.current,
      isLoading: isLoadingRef.current,
      closeStream: closeStreamRef.current,
    });
    closeStreamRef.current = null;
    activeTurnIdRef.current = null;
  }, []);

  /** 写入 session 消息缓存；当前可见 session 同步更新 ref，避免 SSE 高频事件丢字 */
  const commitSessionMessages = useCallback((sid: string, next: Message[]) => {
    const cached = sessionRuntimeRef.current.get(sid) ?? emptyRuntime();
    sessionRuntimeRef.current.set(sid, { ...cached, messages: next });
    if (sid === sessionIdRef.current) {
      messagesRef.current = next;
      setMessages(next);
    }
  }, []);

  const updateSessionMessages = useCallback((sid: string, updater: (prev: Message[]) => Message[]) => {
    const cached = sessionRuntimeRef.current.get(sid);
    const base = sid === sessionIdRef.current ? messagesRef.current : (cached?.messages ?? []);
    commitSessionMessages(sid, updater(base));
  }, [commitSessionMessages]);

  const loadSkills = useCallback(async () => {
    try {
      const list = await skillsApi.listForChat(userId);
      setSkills(list);
      setSelectedSkillRef((prev) =>
        prev && list.some((s) => toSkillRef(s.scope ?? "system", s.name) === prev) ? prev : "",
      );
    } catch {
      setSkills([]);
    }
  }, [userId]);

  const loadSessions = useCallback(async () => {
    if (!userId.trim()) { setSessions([]); return; }
    const list = await getRecentSessions(userId);
    setSessions(list);
  }, [userId]);

  useEffect(() => { loadSkills(); }, [loadSkills]);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  const attachTurnStream = useCallback((
    sid: string,
    turnId: string,
    lastSeq = "0",
  ) => {
    const onDone = () => {
      void (async () => {
        const runtime = sessionRuntimeRef.current.get(sid) ?? emptyRuntime();
        let doneMessages = markAllStreamingDone(runtime.messages);

        // 与刷新一致：turn 结束后用 snapshot 重建，修正流式拼接期间可能丢掉的 token
        try {
          const detail = await getSessionDetail(sid);
          if (detail) {
            doneMessages = buildMessagesFromSnapshot(detail.request, detail.events_snapshot);
          }
        } catch {
          // 保留内存中的消息
        }

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
          messagesRef.current = doneMessages;
          setIsLoading(false);
          setMessages(doneMessages);
        }
        notifyRuntimeChange();
        loadSessions();
      })();
    };

    const onError = (msg: string) => {
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

    const closeFn = streamTurn(
      sid,
      turnId,
      (ev) => {
        if (ev.event === "token") {
          updateSessionMessages(sid, (prev) => appendMessageEvent(prev, "text", ev.data, true));
        } else if (ev.event === "thinking") {
          updateSessionMessages(sid, (prev) => appendMessageEvent(prev, "thinking", ev.data, true));
        } else if (ev.event === "tool_call") {
          updateSessionMessages(sid, (prev) => appendMessageEvent(prev, "tool_call", ev.data));
        } else if (ev.event === "tool_result") {
          updateSessionMessages(sid, (prev) => appendMessageEvent(prev, "tool_result", ev.data));
        }
      },
      onDone,
      onError,
      lastSeq,
    );

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

  const restoreSession = useCallback(async (savedSessionId: string) => {
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
    messagesRef.current = msgs;
    setMessages(msgs);
    sessionRuntimeRef.current.set(savedSessionId, emptyRuntime(msgs));

    const activeTurnId = await getActiveTurn(savedSessionId);
    if (activeTurnId) {
      attachTurnStreamRef.current(savedSessionId, activeTurnId, "0");
    }
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const savedSessionId = localStorage.getItem("pi_session_id");
    const savedUserId = localStorage.getItem("pi_user_id");
    if (!savedSessionId || !savedUserId) return;
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
    messagesRef.current = [];
    setMessages([]);
    syncVisibleSessionState(null);
    setError("");
    setSelectedSkillRef("");
  }, [persistCurrentSession, syncVisibleSessionState]);

  const switchToSession = useCallback(async (s: SessionSummary) => {
    if (sessionIdRef.current === s.session_id) return;

    persistCurrentSession();
    setError("");

    sessionIdRef.current = s.session_id;
    setCurrentSessionId(s.session_id);
    localStorage.setItem("pi_session_id", s.session_id);

    const cached = sessionRuntimeRef.current.get(s.session_id);
    if (cached) {
      messagesRef.current = cached.messages;
      setMessages(cached.messages);
      syncVisibleSessionState(s.session_id);
      return;
    }

    syncVisibleSessionState(s.session_id);
    messagesRef.current = [];
    setMessages([]);

    const detail = await getSessionDetail(s.session_id);
    const msgs = detail ? buildMessagesFromSnapshot(detail.request, detail.events_snapshot) : [];
    messagesRef.current = msgs;
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

  const setUserId = useCallback((newId: string) => {
    setUserIdState(newId);
    localStorage.setItem("pi_user_id", newId);
  }, []);

  const interrupt = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const turnId = activeTurnIdRef.current;
    if (!sessionId || !turnId || !isLoading) return;

    const runtime = sessionRuntimeRef.current.get(sessionId);
    if (runtime?.closeStream) runtime.closeStream();
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
    messagesRef.current = interruptedMessages;
    setMessages(interruptedMessages);
    setIsLoading(false);
    notifyRuntimeChange();

    try {
      await cancelTurn(sessionId, turnId);
      const detail = await getSessionDetail(sessionId);
      if (detail) {
        const rebuilt = buildMessagesFromSnapshot(detail.request, detail.events_snapshot);
        commitSessionMessages(sessionId, rebuilt);
      }
      loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "中断失败");
    }
  }, [isLoading, loadSessions, notifyRuntimeChange, commitSessionMessages]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    if (!userId.trim()) { setError("请先在「历史」页设置用户 ID"); return; }

    setError("");
    setIsLoading(true);
    setMessages((prev) => {
      const next = [...prev, { role: "user" as const, type: "text" as const, content: trimmed }];
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
      } else {
        await sendMessage(sessionId, trimmed, turnId, skillIds);
      }

      attachTurnStream(sessionId, turnId);
    } catch (e) {
      activeTurnIdRef.current = null;
      setError(e instanceof Error ? e.message : "请求失败");
      setIsLoading(false);
    }
  }, [userId, isLoading, selectedSkillRef, attachTurnStream]);

  const value: ChatSessionContextValue = {
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

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  );
}
