import { useEffect, useRef, useState } from "react";
import { SkillScope } from "../api/skills";
import { SkillCreatorMessage, SkillDraft, skillCreatorApi } from "../api/skillCreator";
import ChatMarkdown from "./chat/ChatMarkdown";

interface Props {
  userId?: string;
  scope: SkillScope;
  onClose: () => void;
  onPublished: (skill: { name: string; description: string; tags: string[]; hidden: boolean; scope: SkillScope; user_id: string | null }) => void;
  embedded?: boolean;
  /** 编辑已保存的 Skill 时传入 skill 名称，加载对应的历史会话 */
  editSkillName?: string;
}

export default function SkillCreatorChat({ userId, scope, onClose, onPublished, embedded = false, editSkillName }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SkillCreatorMessage[]>([]);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 当前会话是否已发布（已发布时才显示「新建对话」按钮）
  const [isPublished, setIsPublished] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);

  const scopeLabel = scope === "user" ? "我的 Skill" : "系统 Skill";
  const isEditMode = !!editSkillName;

  const openSession = (forceNew = false, skillName?: string) => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    skillCreatorApi
      .openSession(userId, forceNew, skillName)
      .then((session) => {
        if (cancelled) return;
        setSessionId(session.id);
        setMessages(session.messages);
        setDraft(session.draft ?? null);
        setIsPublished(session.published ?? false);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "无法启动 Skill 创建助手");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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
    if (!text || !sessionId || sending) return;

    setInput("");
    setSending(true);
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;

    try {
      const res = await skillCreatorApi.sendMessage(sessionId, text, ctrl.signal);
      setMessages((prev) => [...prev, res.message]);
      if (res.draft) setDraft(res.draft);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        // 用户主动中断，不展示错误
      } else {
        setError(e instanceof Error ? e.message : "发送失败");
      }
    } finally {
      abortCtrlRef.current = null;
      setSending(false);
    }
  };

  const handleInterrupt = () => {
    abortCtrlRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法组合期间的 Enter 不触发发送
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePublish = async () => {
    if (!sessionId || !draft || publishing) return;
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setPublishing(false);
    }
  };

  const panel = (
    <div className={`bg-white/95 backdrop-blur-xl rounded-2.5xl shadow-panel w-full flex flex-col border border-ink-200/60 ${
      embedded ? "h-[70vh]" : "max-w-4xl h-[90vh]"
    }`}>
      <div className="px-6 py-4 border-b border-ink-200/60 flex items-center justify-between shrink-0">
        <div>
          <h2 className="font-semibold text-ink-900">
            {isEditMode ? `编辑 Skill：${editSkillName}` : `对话创建${scopeLabel}`}
          </h2>
          <p className="text-xs text-ink-400 mt-0.5">
            {isEditMode
              ? "继续对话完善已保存的 Skill，修改后重新保存"
              : "通过对话生成 Skill；若依赖外部工具，请说明 MCP Server 名称与用途"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* 未发布草稿才允许重新开始（编辑已保存 skill 的会话不能清） */}
          {!isPublished && !isEditMode && sessionId && (
            <button
              type="button"
              onClick={() => {
                if (!confirm("确认清除当前对话历史，重新开始？")) return;
                skillCreatorApi.resetSession(sessionId).then((session) => {
                  setMessages(session.messages);
                  setDraft(null);
                  setInput("");
                });
              }}
              disabled={loading || sending}
              className="text-xs text-ink-400 hover:text-red-500 disabled:opacity-40 transition-colors"
            >
              重新开始
            </button>
          )}
          {/* 已发布后才允许新建，编辑模式下不提供（新建会脱离当前 skill 上下文） */}
          {isPublished && !isEditMode && (
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setInput("");
                setIsPublished(false);
                openSession(true);
              }}
              disabled={loading || sending}
              className="text-xs text-ink-400 hover:text-brand-600 disabled:opacity-40 transition-colors"
            >
              新建对话
            </button>
          )}
          <button type="button" onClick={onClose} className="text-sm text-ink-400 hover:text-ink-700 transition-colors">关闭</button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col border-r min-w-0">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {loading && <p className="text-sm text-gray-400 text-center py-8">正在连接 Skill 创建助手…</p>}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft whitespace-pre-wrap"
                    : "bg-ink-100/80 text-ink-800 border border-ink-200/60"
                }`}>
                  {m.role === "user" ? m.content : <ChatMarkdown content={m.content} />}
                </div>
              </div>
            ))}
            {sending && <p className="text-xs text-gray-400">助手思考中…</p>}
            <div ref={bottomRef} />
          </div>

          {error && (
            <p className="mx-4 mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="px-4 py-3 border-t flex gap-2 items-end shrink-0">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="描述 Skill 场景；若用 MCP，请写清 Server 名称与用途…  Shift+Enter 换行"
              disabled={loading || !sessionId}
              className="flex-1 resize-none bg-transparent border border-ink-200/80 rounded-xl px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-300 transition-all duration-200 disabled:opacity-60"
            />
            {sending ? (
              <button
                type="button"
                onClick={handleInterrupt}
                className="ui-btn-danger shrink-0"
              >
                中断
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={loading || !sessionId || !input.trim()}
                className="ui-btn-primary shrink-0"
              >
                发送
              </button>
            )}
          </div>
        </div>

        <div className="w-80 flex flex-col shrink-0 bg-gray-50">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-medium text-gray-700">草稿预览</h3>
            <p className="text-xs text-gray-500 mt-0.5">继续对话完善，定稿后保存</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 text-xs">
            {!draft ? (
              <p className="text-gray-400 text-center py-8">对话生成 Skill 后显示在此</p>
            ) : (
              <>
                <PreviewRow label="名称" value={draft.name} />
                <PreviewRow label="描述" value={draft.description} />
                {(draft.tags ?? []).length > 0 && (
                  <PreviewRow label="标签" value={(draft.tags ?? []).join(", ")} />
                )}
                {(draft.mcp_servers ?? []).length > 0 && (
                  <PreviewRow label="MCP Servers" value={(draft.mcp_servers ?? []).join(", ")} />
                )}
                <div>
                  <p className="font-medium text-gray-600 mb-1">正文</p>
                  <pre className="bg-white border rounded-lg p-2 text-[10px] whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">{draft.content}</pre>
                </div>
              </>
            )}
          </div>
          <div className="px-4 py-3 border-t">
            <button
              onClick={handlePublish}
              disabled={!draft || publishing}
              className="w-full ui-btn-primary"
            >
              {publishing ? "保存中…" : "保存 Skill"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (embedded) return panel;

  return (
    <div className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      {panel}
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-medium text-gray-600">{label}</p>
      <p className="text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}
