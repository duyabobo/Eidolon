import { useEffect, useRef, useState } from "react";
import { Skill, SkillScope } from "../api/skills";
import { SkillCreatorMessage, SkillDraft, skillCreatorApi } from "../api/skillCreator";

interface Props {
  userId?: string;
  scope: SkillScope;
  onClose: () => void;
  onPublished: (skill: Skill) => void;
}

export default function SkillCreatorChat({ userId, scope, onClose, onPublished }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SkillCreatorMessage[]>([]);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scopeLabel = scope === "user" ? "我的 Skill" : "系统 Skill";

  useEffect(() => {
    let cancelled = false;
    skillCreatorApi
      .createSession(userId)
      .then((res) => {
        if (cancelled) return;
        setSessionId(res.session_id);
        setMessages([res.message]);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "无法启动 Skill 创建助手");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

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
    try {
      const res = await skillCreatorApi.sendMessage(sessionId, text);
      setMessages((prev) => [...prev, res.message]);
      if (res.draft) setDraft(res.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  const handlePublish = async () => {
    if (!sessionId || !draft || publishing) return;
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-gray-800">对话创建{scopeLabel}</h2>
            <p className="text-xs text-gray-500 mt-0.5">通过 skill-creator 对话生成，保存后同步 MongoDB + NFS</p>
          </div>
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">关闭</button>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col border-r min-w-0">
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {loading && <p className="text-sm text-gray-400 text-center py-8">正在连接 Skill 创建助手…</p>}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-800"
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {sending && <p className="text-xs text-gray-400">助手思考中…</p>}
              <div ref={bottomRef} />
            </div>

            {error && (
              <p className="mx-4 mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="px-4 py-3 border-t flex gap-2 shrink-0">
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                placeholder="描述你想创建的 Skill…"
                disabled={loading || sending || !sessionId}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                onClick={handleSend}
                disabled={loading || sending || !sessionId || !input.trim()}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 shrink-0"
              >
                发送
              </button>
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
                className="w-full px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {publishing ? "保存中…" : "保存 Skill"}
              </button>
            </div>
          </div>
        </div>
      </div>
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
