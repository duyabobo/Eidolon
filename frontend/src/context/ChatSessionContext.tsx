import {
  createContext, useContext, useState, useRef, useEffect, useCallback, ReactNode,
} from "react";
import {
  createSession, sendMessage, cancelTurn,
  streamTurn, getRecentSessions, getSessionDetail, getActiveTurn,
  SessionSummary,
} from "../api/session";
import { skillsApi, Skill, toSkillRef } from "../api/skills";
import { workspaceApi, type ChatUploadResponse } from "../api/workspace";

export type MessageType = "text" | "thinking" | "tool_call" | "tool_result" | "file";

export interface Message {
  role: "user" | "assistant";
  type: MessageType;
  content: string;
  isStreaming?: boolean;
  /** 步骤开始时间（ms），流式事件到达时记录 */
  startedAt?: number;
  /** 步骤结束时间（ms） */
  endedAt?: number;
  /** user_file：相对 session workspace 的路径 */
  relativePath?: string;
  /** user_file：字节大小 */
  size?: number;
  /** user_file：knowledge / mRAG 文档 ID */
  docId?: string;
  /** user_file：所在知识库 ID */
  kbId?: string;
}

/** 收集紧邻本轮文本之前的连续 user_file（上一条/若干条附件）。 */
export function collectTrailingFileMessages(messages: Message[]): Message[] {
  const files: Message[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === "user" && msg.type === "file") {
      files.unshift(msg);
      continue;
    }
    break;
  }
  return files;
}

/** 把相邻附件与用户 query 拼成发给 pi 的单条 request（仅进 JSONL，不写 Mongo）。 */
export function buildPiRequestWithAttachments(
  text: string,
  files: Array<Pick<Message, "content" | "relativePath" | "docId" | "kbId">>,
): string {
  const trimmed = text.trim();
  if (!files.length) return trimmed;
  const lines = files.map((f) => {
    const path = f.relativePath || f.content;
    const meta = [
      f.docId ? `doc_id=${f.docId}` : null,
      f.kbId ? `kb_id=${f.kbId}` : null,
    ].filter(Boolean).join(", ");
    return meta
      ? `- ${f.content} (workspace: ${path}, ${meta})`
      : `- ${f.content} (workspace: ${path})`;
  });
  return [
    "[用户上传的附件]",
    ...lines,
    "",
    "[用户消息]",
    trimmed,
  ].join("\n");
}

function fileMessageFromUpload(file: ChatUploadResponse, now: number): Message {
  return {
    role: "user",
    type: "file",
    content: file.filename,
    relativePath: file.relative_path,
    size: file.size,
    docId: file.doc_id,
    kbId: file.kb_id,
    startedAt: now,
    endedAt: now,
  };
}

interface SessionRuntime {
  messages: Message[];
  activeTurnId: string | null;
  isLoading: boolean;
  closeStream: (() => void) | null;
  selectedSkillRef: string;
}

function emptyRuntime(messages: Message[] = [], selectedSkillRef = ""): SessionRuntime {
  return { messages, activeTurnId: null, isLoading: false, closeStream: null, selectedSkillRef };
}

function loadPersistedSkillRef(sessionId: string): string {
  return localStorage.getItem(`pi_skill_ref_${sessionId}`) ?? "";
}

function savePersistedSkillRef(sessionId: string, ref: string): void {
  if (ref) {
    localStorage.setItem(`pi_skill_ref_${sessionId}`, ref);
  } else {
    localStorage.removeItem(`pi_skill_ref_${sessionId}`);
  }
}

type SnapshotEvent = {
  event_type: string;
  content?: string;
  filename?: string;
  relative_path?: string;
  size?: number;
  doc_id?: string;
  kb_id?: string;
  ts?: number | string;
};

export function buildMessagesFromSnapshot(
  request: string,
  snapshot: SnapshotEvent[],
): Message[] {
  const hasUserMessages = snapshot.some(
    (e) => e.event_type === "user_message" || e.event_type === "user_file",
  );
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

    if (event.event_type === "user_file") {
      const filename = event.filename || content || "附件";
      msgs.push({
        role: "user",
        type: "file",
        content: filename,
        relativePath: event.relative_path || filename,
        size: typeof event.size === "number" ? event.size : undefined,
        docId: event.doc_id || undefined,
        kbId: event.kb_id || undefined,
        startedAt: ts,
        endedAt: ts,
      });
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

function assistantContentLength(msgs: Message[]): number {
  return msgs
    .filter((m) => m.role === "assistant")
    .reduce((n, m) => n + (m.content?.length ?? 0), 0);
}

/** 取 assistant 内容更完整的一份，避免 snapshot 尚未入库时用空数据覆盖内存消息 */
function pickRicherMessages(memory: Message[], snapshot: Message[]): Message[] {
  const memoryLen = assistantContentLength(memory);
  const snapshotLen = assistantContentLength(snapshot);
  if (snapshotLen > memoryLen) return snapshot;
  if (memoryLen > snapshotLen) return memory;
  return snapshot.length >= memory.length ? snapshot : memory;
}

async function rebuildMessagesFromSession(
  sid: string,
  memory: Message[],
  maxAttempts = 3,
): Promise<Message[]> {
  let best = memory;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const detail = await getSessionDetail(sid);
      if (!detail) break;
      const snapshot = buildMessagesFromSnapshot(detail.request, detail.events_snapshot);
      best = pickRicherMessages(memory, snapshot);
      if (assistantContentLength(best) >= assistantContentLength(memory)) {
        return best;
      }
    } catch {
      break;
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  return best;
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
  send: (text: string, pendingFiles?: File[]) => Promise<void>;
  /** 附件上传成功后追加到当前会话消息列表（持久化由上传 API 写入 snapshot） */
  appendUploadedFile: (file: {
    filename: string;
    relative_path: string;
    size: number;
    doc_id: string;
    kb_id: string;
  }) => void;
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
  const [selectedSkillRef, setSelectedSkillRefState] = useState("");
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
  const selectedSkillRefRef = useRef<string>("");
  const sessionRuntimeRef = useRef<Map<string, SessionRuntime>>(new Map());
  const attachTurnStreamRef = useRef<(sid: string, turnId: string, lastSeq?: string) => void>(() => {});
  const restoredRef = useRef(false);

  const notifyRuntimeChange = useCallback(() => setRuntimeTick((t) => t + 1), []);

  const isSessionGenerating = useCallback((sid: string) => (
    sessionRuntimeRef.current.get(sid)?.isLoading ?? false
  ), []);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
  useEffect(() => { selectedSkillRefRef.current = selectedSkillRef; }, [selectedSkillRef]);

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
    const skillRef = selectedSkillRefRef.current;
    sessionRuntimeRef.current.set(sid, {
      messages: messagesRef.current,
      activeTurnId: activeTurnIdRef.current,
      isLoading: isLoadingRef.current,
      closeStream: closeStreamRef.current,
      selectedSkillRef: skillRef,
    });
    savePersistedSkillRef(sid, skillRef);
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
      // 若当前选中的 skill 已不在列表中（被删除等），清空选择
      const current = selectedSkillRefRef.current;
      if (current && !list.some((s) => toSkillRef(s.scope ?? "system", s.name) === current)) {
        selectedSkillRefRef.current = "";
        setSelectedSkillRefState("");
      }
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
        const memoryMessages = markAllStreamingDone(
          sid === sessionIdRef.current ? messagesRef.current : runtime.messages,
        );

        const doneMessages = await rebuildMessagesFromSession(sid, memoryMessages);

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

    const skillRef = loadPersistedSkillRef(savedSessionId);
    selectedSkillRefRef.current = skillRef;
    setSelectedSkillRefState(skillRef);
    sessionRuntimeRef.current.set(savedSessionId, emptyRuntime(msgs, skillRef));

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
    selectedSkillRefRef.current = "";
    setSelectedSkillRefState("");
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
      const skillRef = cached.selectedSkillRef ?? loadPersistedSkillRef(s.session_id);
      selectedSkillRefRef.current = skillRef;
      setSelectedSkillRefState(skillRef);
      syncVisibleSessionState(s.session_id);
      return;
    }

    const skillRef = loadPersistedSkillRef(s.session_id);
    selectedSkillRefRef.current = skillRef;
    setSelectedSkillRefState(skillRef);
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

  const setSelectedSkillRef = useCallback((ref: string) => {
    setSelectedSkillRefState(ref);
    selectedSkillRefRef.current = ref;
    const sid = sessionIdRef.current;
    if (sid) {
      const runtime = sessionRuntimeRef.current.get(sid) ?? emptyRuntime(messagesRef.current);
      sessionRuntimeRef.current.set(sid, { ...runtime, selectedSkillRef: ref });
      savePersistedSkillRef(sid, ref);
    }
  }, []);

  const interrupt = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !isLoading) return;

    // 优先用服务端当前活跃 turn，避免 recovery 竞态导致本地 turn 过期、中断被忽略
    const serverTurn = await getActiveTurn(sessionId).catch(() => null);
    const turnId = serverTurn ?? activeTurnIdRef.current;
    if (!turnId) return;

    const runtime = sessionRuntimeRef.current.get(sessionId);
    if (runtime?.closeStream) runtime.closeStream();
    closeStreamRef.current = null;

    // 中断完成前保持 isLoading，防止立刻发新消息撞上尚未结束的 pi 轮次
    try {
      await cancelTurn(sessionId, turnId);

      const interruptedMessages = markAllStreamingDone(messagesRef.current);
      sessionRuntimeRef.current.set(sessionId, {
        ...(runtime ?? emptyRuntime()),
        messages: interruptedMessages,
        activeTurnId: null,
        isLoading: false,
        closeStream: null,
      });
      messagesRef.current = interruptedMessages;
      activeTurnIdRef.current = null;
      setMessages(interruptedMessages);
      setIsLoading(false);
      notifyRuntimeChange();

      const detail = await getSessionDetail(sessionId);
      if (detail) {
        const rebuilt = buildMessagesFromSnapshot(detail.request, detail.events_snapshot);
        commitSessionMessages(sessionId, rebuilt);
      }
      loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "中断失败");
      setIsLoading(false);
      activeTurnIdRef.current = null;
      notifyRuntimeChange();
    }
  }, [isLoading, loadSessions, notifyRuntimeChange, commitSessionMessages]);

  const send = useCallback(async (text: string, pendingFiles: File[] = []) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    if (!userId.trim()) { setError("请先在右上角「历史」中设置用户 ID"); return; }

    setError("");
    setIsLoading(true);

    const turnId = crypto.randomUUID();
    const skillIds = selectedSkillRefRef.current ? [selectedSkillRefRef.current] : [];
    const trailingFiles = collectTrailingFileMessages(messagesRef.current);

    try {
      let sessionId = sessionIdRef.current;
      const uploadedExtras: Message[] = [];

      if (!sessionId) {
        // 有挂起附件时先建 IDLE 会话，上传后再 /messages 启动首轮
        const deferStart = pendingFiles.length > 0;
        const resp = await createSession(
          userId,
          trimmed,
          turnId,
          skillIds,
          deferStart,
        );
        sessionId = resp.session_id;
        sessionIdRef.current = sessionId;
        setCurrentSessionId(sessionId);
        localStorage.setItem("pi_session_id", sessionId);
        sessionRuntimeRef.current.set(sessionId, emptyRuntime(messagesRef.current));
        setSessions((prev) => {
          const entry = {
            session_id: sessionId!,
            status: resp.status,
            request: trimmed,
            created_at: new Date().toISOString(),
            completed_at: null,
          };
          return [entry, ...prev.filter((s) => s.session_id !== sessionId)];
        });
        void loadSessions();

        if (deferStart) {
          for (const file of pendingFiles) {
            const res = await workspaceApi.uploadToSession(userId, sessionId, file);
            uploadedExtras.push(fileMessageFromUpload(res, Date.now()));
          }
          const piRequest = buildPiRequestWithAttachments(
            trimmed,
            [...trailingFiles, ...uploadedExtras],
          );
          const now = Date.now();
          setMessages((prev) => {
            const next = [
              ...prev,
              ...uploadedExtras,
              {
                role: "user" as const,
                type: "text" as const,
                content: trimmed,
                startedAt: now,
                endedAt: now,
              },
            ];
            messagesRef.current = next;
            return next;
          });
          await sendMessage(sessionId, trimmed, turnId, skillIds, piRequest);
          attachTurnStream(sessionId, turnId);
          return;
        }

        const now = Date.now();
        setMessages((prev) => {
          const next = [...prev, {
            role: "user" as const,
            type: "text" as const,
            content: trimmed,
            startedAt: now,
            endedAt: now,
          }];
          messagesRef.current = next;
          return next;
        });
        attachTurnStream(sessionId, turnId);
        return;
      }

      // 已有 session：先传 pending（若有），再合并相邻附件发 pi
      for (const file of pendingFiles) {
        const res = await workspaceApi.uploadToSession(userId, sessionId, file);
        uploadedExtras.push(fileMessageFromUpload(res, Date.now()));
      }
      const piRequest = buildPiRequestWithAttachments(
        trimmed,
        [...trailingFiles, ...uploadedExtras],
      );
      const now = Date.now();
      setMessages((prev) => {
        const next = [
          ...prev,
          ...uploadedExtras,
          {
            role: "user" as const,
            type: "text" as const,
            content: trimmed,
            startedAt: now,
            endedAt: now,
          },
        ];
        messagesRef.current = next;
        return next;
      });
      await sendMessage(sessionId, trimmed, turnId, skillIds, piRequest);
      attachTurnStream(sessionId, turnId);
    } catch (e) {
      activeTurnIdRef.current = null;
      setError(e instanceof Error ? e.message : "请求失败");
      setIsLoading(false);
    }
  }, [userId, isLoading, attachTurnStream, loadSessions]);

  const appendUploadedFile = useCallback((file: {
    filename: string;
    relative_path: string;
    size: number;
    doc_id: string;
    kb_id: string;
  }) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const now = Date.now();
    updateSessionMessages(sid, (prev) => [
      ...prev,
      {
        role: "user",
        type: "file",
        content: file.filename,
        relativePath: file.relative_path,
        size: file.size,
        docId: file.doc_id,
        kbId: file.kb_id,
        startedAt: now,
        endedAt: now,
      },
    ]);
  }, [updateSessionMessages]);

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
    appendUploadedFile,
    isSessionGenerating,
  };

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  );
}
