import { useState, useRef, useEffect, useCallback } from "react";
import {
  createSession, sendMessage, cancelTurn,
  streamTurn, getRecentSessions, getSessionDetail, getActiveTurn,
  SessionSummary,
} from "../api/session";
import { skillsApi, Skill, SkillScope, toSkillRef } from "../api/skills";
import SkillCreatorChat from "../components/SkillCreatorChat";
import UserMcpPanel from "../components/UserMcpPanel";

// ── 消息结构 ────────────────────────────────────────────────────────────────

type MessageType = "text" | "thinking" | "tool_call" | "tool_result";

interface Message {
  role: "user" | "assistant";
  type: MessageType;
  content: string;
  isStreaming?: boolean;
}

// ── 快照重建 ────────────────────────────────────────────────────────────────

function buildMessagesFromSnapshot(
  request: string,
  snapshot: Array<{ event_type: string; content: string }>
): Message[] {
  // 新格式：snapshot 含 user_message 事件，直接从 snapshot 重建完整对话
  // 旧格式：snapshot 无 user_message，用 request 作为第一条兜底（向后兼容）
  const hasUserMessages = snapshot.some((e) => e.event_type === "user_message");
  const msgs: Message[] = hasUserMessages
    ? []
    : [{ role: "user", type: "text", content: request }];

  for (const event of snapshot) {
    const last = msgs[msgs.length - 1];
    if (event.event_type === "user_message") {
      msgs.push({ role: "user", type: "text", content: event.content });
    } else if (event.event_type === "token") {
      if (last?.role === "assistant" && last.type === "text") {
        last.content += event.content;
      } else {
        msgs.push({ role: "assistant", type: "text", content: event.content });
      }
    } else if (event.event_type === "thinking") {
      if (last?.role === "assistant" && last.type === "thinking") {
        last.content += event.content;
      } else {
        msgs.push({ role: "assistant", type: "thinking", content: event.content });
      }
    } else if (event.event_type === "tool_call") {
      msgs.push({ role: "assistant", type: "tool_call", content: event.content });
    } else if (event.event_type === "tool_result") {
      msgs.push({ role: "assistant", type: "tool_result", content: event.content });
    }
  }
  return msgs;
}

/** 向消息列表追加流式/离散事件 */
function appendMessageEvent(prev: Message[], type: MessageType, text: string, streaming = false): Message[] {
  const last = prev[prev.length - 1];
  if (streaming && last?.role === "assistant" && last.type === type) {
    return [...prev.slice(0, -1), { ...last, content: last.content + text, isStreaming: true }];
  }
  if (type === "text" || type === "thinking") {
    return [...prev, { role: "assistant", type, content: text, isStreaming: streaming }];
  }
  return [...prev, { role: "assistant", type, content: text }];
}

function markAllStreamingDone(prev: Message[]): Message[] {
  return prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
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

// ── 消息块渲染 ──────────────────────────────────────────────────────────────

function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [open, setOpen] = useState(!!isStreaming);
  useEffect(() => { if (isStreaming) setOpen(true); }, [isStreaming]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!isStreaming) setOpen(false); }, [isStreaming]);
  return (
    <div className="max-w-[80%] text-xs">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-gray-400 hover:text-gray-600 transition-colors mb-1">
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <span className="italic">{isStreaming ? "正在思考…" : "思考过程"}</span>
        {isStreaming && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
      </button>
      {open && <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-gray-500 italic whitespace-pre-wrap break-words leading-relaxed">{content}</div>}
    </div>
  );
}

function ToolCallBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(true);
  let name = ""; let inputText = "";
  try { const p = JSON.parse(content) as { name: string; input: unknown }; name = p.name; inputText = JSON.stringify(p.input, null, 2); }
  catch { inputText = content; }
  return (
    <div className="max-w-[80%] text-xs">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700 transition-colors mb-1">
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        <span className="font-mono font-medium text-indigo-600">{name || "工具调用"}</span>
      </button>
      {open && <pre className="bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 text-gray-600 overflow-x-auto">{inputText}</pre>}
    </div>
  );
}

function ToolResultBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  let name = ""; let outputText = ""; let isError = false;
  try { const p = JSON.parse(content) as { name: string; output: string; isError?: boolean }; name = p.name; outputText = p.output; isError = !!p.isError; }
  catch { outputText = content; }
  return (
    <div className="max-w-[80%] text-xs">
      <button onClick={() => setOpen((v) => !v)} className={`flex items-center gap-1 transition-colors mb-1 ${isError ? "text-red-400 hover:text-red-600" : "text-green-500 hover:text-green-700"}`}>
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        {isError
          ? <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          : <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
        <span className={`font-mono font-medium ${isError ? "text-red-500" : "text-green-600"}`}>{name ? `${name} 结果` : "执行结果"}</span>
      </button>
      {open && <pre className={`border rounded-xl px-3 py-2 overflow-x-auto ${isError ? "bg-red-50 border-red-100 text-red-600" : "bg-green-50 border-green-100 text-gray-600"}`}>{outputText}</pre>}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words bg-indigo-600 text-white rounded-br-sm">{msg.content}</div>
    </div>
  );
  if (msg.type === "thinking") return <div className="flex justify-start"><ThinkingBlock content={msg.content} isStreaming={msg.isStreaming} /></div>;
  if (msg.type === "tool_call") return <div className="flex justify-start"><ToolCallBlock content={msg.content} /></div>;
  if (msg.type === "tool_result") return <div className="flex justify-start"><ToolResultBlock content={msg.content} /></div>;
  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm">
        {msg.content}
        {msg.isStreaming && <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1 align-middle rounded-sm" />}
      </div>
    </div>
  );
}

function SkillScopeBadge({ scope }: { scope: SkillScope }) {
  const isUser = scope === "user";
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${isUser ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
      {isUser ? "我的" : "系统"}
    </span>
  );
}

function SkillOptionGroup({ label, scope, skills }: { label: string; scope: SkillScope; skills: Skill[] }) {
  if (skills.length === 0) return null;
  return (
    <optgroup label={label}>
      {skills.map((s) => {
        const value = toSkillRef(scope, s.name);
        return <option key={value} value={value} title={s.description}>{s.name}</option>;
      })}
    </optgroup>
  );
}

// ── 主页面 ───────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [userId, setUserId] = useState(() => localStorage.getItem("pi_user_id") ?? "");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkillRef, setSelectedSkillRef] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showSkillCreator, setShowSkillCreator] = useState(false);
  const [showMcpPanel, setShowMcpPanel] = useState(false);
  /** 当前可见 session，用于 UI 与 loading 状态隔离 */
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    () => localStorage.getItem("pi_session_id"),
  );
  /** 触发侧栏等依赖 sessionRuntime 的 UI 刷新 */
  const [runtimeTick, setRuntimeTick] = useState(0);

  const notifyRuntimeChange = useCallback(() => setRuntimeTick((t) => t + 1), []);

  const isSessionGenerating = useCallback((sid: string) => (
    sessionRuntimeRef.current.get(sid)?.isLoading ?? false
  ), []);

  // session_id：当前 chat 窗口的 session，null 表示尚未创建
  const sessionIdRef = useRef<string | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const closeStreamRef = useRef<(() => void) | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const isLoadingRef = useRef(false);
  const sessionRuntimeRef = useRef<Map<string, SessionRuntime>>(new Map());
  const attachTurnStreamRef = useRef<(sid: string, turnId: string, lastSeq?: string) => void>(() => {});
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  // 页面加载时从 localStorage 恢复上次会话
  useEffect(() => {
    const savedSessionId = localStorage.getItem("pi_session_id");
    const savedUserId = localStorage.getItem("pi_user_id");
    if (!savedSessionId || !savedUserId) return;

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

  const loadSkills = useCallback(async (uid: string) => {
    try {
      const list = await skillsApi.listForChat(uid);
      setSkills(list);
      setSelectedSkillRef((prev) =>
        prev && list.some((s) => toSkillRef(s.scope ?? "system", s.name) === prev) ? prev : ""
      );
    } catch {
      setSkills([]);
    }
  }, []);

  useEffect(() => {
    loadSkills(userId);
  }, [userId, loadSkills]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadSessions = useCallback(async (uid: string) => {
    if (!uid.trim()) { setSessions([]); return; }
    const list = await getRecentSessions(uid);
    setSessions(list);
  }, []);

  useEffect(() => {
    if (userId.trim()) loadSessions(userId);
  }, [userId, loadSessions]);

  /** 将顶部/输入区的 loading 与当前可见 session 对齐（会话间隔离） */
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

  /** 切换离开当前会话时，保留 SSE 与消息缓存在内存中（不关闭后端 session） */
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

  const updateSessionMessages = useCallback((sid: string, updater: (prev: Message[]) => Message[]) => {
    const cached = sessionRuntimeRef.current.get(sid);
    const base = sid === sessionIdRef.current ? messagesRef.current : (cached?.messages ?? []);
    const next = updater(base);
    sessionRuntimeRef.current.set(sid, {
      ...(cached ?? emptyRuntime()),
      messages: next,
    });
    if (sid === sessionIdRef.current) setMessages(next);
  }, []);

  const attachTurnStream = useCallback((
    sid: string,
    turnId: string,
    lastSeq = "0",
  ) => {
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
  }, [loadSessions, updateSessionMessages, userId, notifyRuntimeChange]);

  useEffect(() => {
    attachTurnStreamRef.current = attachTurnStream;
  }, [attachTurnStream]);

  /** 点击历史侧边栏，加载某个 session 的消息记录 */
  const switchToSession = useCallback(async (s: SessionSummary) => {
    if (sessionIdRef.current === s.session_id) return;

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
    setMessages(interruptedMessages);
    setIsLoading(false);
    notifyRuntimeChange();

    try {
      await cancelTurn(sessionId, turnId);
      if (userId.trim()) loadSessions(userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "中断失败");
    }
  }, [isLoading, userId, loadSessions, notifyRuntimeChange]);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    if (!userId.trim()) { setError("请先填写用户 ID"); return; }

    localStorage.setItem("pi_user_id", userId);
    setError("");
    setInput("");
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
  }, [input, userId, isLoading, selectedSkillRef, attachTurnStream]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handleUserIdChange = (newId: string) => {
    setUserId(newId);
    startNewChat();
    if (newId.trim()) loadSessions(newId);
  };

  return (
    <div className="flex h-[calc(100vh-53px)]">
      {/* 历史 session 侧边栏 */}
      {showHistory && (
        <div className="w-64 border-r bg-gray-50 flex flex-col shrink-0">
          <div className="px-3 py-2 border-b bg-white flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">历史对话</span>
            <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <p className="text-xs text-gray-400 text-center mt-8 px-3">暂无历史对话</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={`${s.session_id}-${runtimeTick}`}
                  onClick={() => switchToSession(s)}
                  className={`w-full text-left px-3 py-2 border-b hover:bg-indigo-50 transition-colors ${
                    s.session_id === currentSessionId ? "bg-indigo-50 border-l-2 border-l-indigo-500" : ""
                  }`}
                >
                  <p className="text-xs text-gray-800 truncate">{s.request}</p>
                  <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                      isSessionGenerating(s.session_id) ? "bg-yellow-400 animate-pulse" :
                      s.status === "COMPLETED" ? "bg-green-400" :
                      s.status === "RUNNING" ? "bg-yellow-400" :
                      s.status === "FAILED" ? "bg-red-400" : "bg-gray-300"
                    }`} />
                    <span>{new Date(s.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* 主聊天区 */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-wrap">
          <button
            onClick={() => { setShowHistory((v) => !v); if (!showHistory && userId.trim()) loadSessions(userId); }}
            title="历史对话"
            className="text-gray-400 hover:text-indigo-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          <button
            onClick={startNewChat}
            title="新对话"
            className="text-gray-400 hover:text-indigo-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v16m8-8H4" />
            </svg>
          </button>

          <label className="text-sm text-gray-500 whitespace-nowrap">用户 ID</label>
          <input
            value={userId}
            onChange={(e) => handleUserIdChange(e.target.value)}
            placeholder="alice"
            className="text-sm border border-gray-300 rounded px-2 py-1 w-32 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />

          <span className="text-gray-300">|</span>

          <label className="text-sm text-gray-500 whitespace-nowrap">Skill</label>
          <select
            value={selectedSkillRef}
            onChange={(e) => setSelectedSkillRef(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 max-w-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="">默认（不指定）</option>
            <SkillOptionGroup label="系统 Skill" scope="system" skills={skills.filter((s) => (s.scope ?? "system") === "system")} />
            <SkillOptionGroup label="我的 Skill" scope="user" skills={skills.filter((s) => s.scope === "user")} />
          </select>
          {selectedSkillRef && (() => {
            const item = skills.find((s) => toSkillRef(s.scope ?? "system", s.name) === selectedSkillRef);
            if (!item) return null;
            return (
              <span className="text-xs text-indigo-500 flex items-center gap-1">
                <SkillScopeBadge scope={item.scope ?? "system"} />
                {item.description}
              </span>
            );
          })()}

          <button
            onClick={() => {
              if (!userId.trim()) { setError("请先填写用户 ID"); return; }
              setShowMcpPanel(true);
            }}
            title="管理 MCP"
            className="text-xs px-2 py-1 border border-sky-300 text-sky-700 rounded-lg hover:bg-sky-50 whitespace-nowrap"
          >
            MCP
          </button>

          <button
            onClick={() => {
              if (!userId.trim()) { setError("请先填写用户 ID"); return; }
              setShowSkillCreator(true);
            }}
            title="对话创建我的 Skill"
            className="text-xs px-2 py-1 border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 whitespace-nowrap"
          >
            + 创建 Skill
          </button>

          {isLoading && (
            <>
              <span className="ml-auto text-xs text-indigo-500 animate-pulse whitespace-nowrap">
                Pi 正在执行…
              </span>
              <button
                onClick={interrupt}
                className="text-xs px-2 py-1 border border-orange-300 text-orange-600 rounded-lg hover:bg-orange-50 whitespace-nowrap"
              >
                中断
              </button>
            </>
          )}
          {error && <span className={`text-xs text-red-500 ${isLoading ? "" : "ml-auto"}`}>{error}</span>}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20 text-sm">
              选择 Skill（可选），发送消息，Pi Agent 将为你执行任务
            </div>
          )}
          {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
          <div ref={bottomRef} />
        </div>

        <div className="bg-white border-t px-4 py-3">
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入你的请求… (Enter 发送，Shift+Enter 换行)"
              rows={2}
              className="flex-1 resize-none border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            {isLoading ? (
              <button
                onClick={interrupt}
                className="px-4 py-2 bg-orange-500 text-white text-sm rounded-xl hover:bg-orange-600 transition-colors"
              >
                中断
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                发送
              </button>
            )}
          </div>
        </div>
      </div>

      {showMcpPanel && userId.trim() && (
        <UserMcpPanel userId={userId.trim()} onClose={() => setShowMcpPanel(false)} />
      )}

      {showSkillCreator && userId.trim() && (
        <SkillCreatorChat
          userId={userId.trim()}
          scope="user"
          onClose={() => setShowSkillCreator(false)}
          onPublished={(skill) => {
            loadSkills(userId);
            setSelectedSkillRef(toSkillRef("user", skill.name));
            setError("");
          }}
        />
      )}
    </div>
  );
}
