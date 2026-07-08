import { useEffect, useRef, useState } from "react";
import { Skill } from "../api/skills";
import { SkillCreatorMessage, SkillDraft, skillCreatorApi } from "../api/skillCreator";

interface Props {
  onClose: () => void;
  onPublished: (skill: Skill) => void;
}

export default function SkillCreatorChat({ onClose, onPublished }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SkillCreatorMessage[]>([]);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(false);
  const [draftForm, setDraftForm] = useState<SkillDraft>({ name: "", description: "", content: "", tags: [] });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    skillCreatorApi
      .createSession()
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
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

  useEffect(() => {
    if (draft) {
      setDraftForm({
        name: draft.name,
        description: draft.description,
        content: draft.content,
        tags: draft.tags ?? [],
      });
    }
  }, [draft]);

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
    if (!sessionId || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const payload = editDraft
        ? {
            name: draftForm.name.trim(),
            description: draftForm.description.trim(),
            content: draftForm.content.trim(),
            tags: draftForm.tags,
          }
        : {};
      const saved = await skillCreatorApi.publish(sessionId, payload);
      onPublished({
        name: saved.name,
        description: saved.description,
        tags: saved.tags,
        hidden: saved.hidden,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setPublishing(false);
    }
  };

  const tagsText = (draftForm.tags ?? []).join(", ");

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-gray-800">对话创建 Skill</h2>
            <p className="text-xs text-gray-500 mt-0.5">基于 skill-creator，通过对话生成 SKILL.md 并发布</p>
          </div>
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">关闭</button>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col border-r min-w-0">
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {loading && <p className="text-sm text-gray-400 text-center py-8">正在连接 Skill 创建助手…</p>}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {sending && (
                <p className="text-xs text-gray-400">助手思考中…</p>
              )}
              <div ref={bottomRef} />
            </div>

            {error && (
              <p className="mx-4 mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="px-4 py-3 border-t flex gap-2 shrink-0">
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="描述你想创建的 Skill…（Enter 发送，Shift+Enter 换行）"
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
              <h3 className="text-sm font-medium text-gray-700">Skill 草稿预览</h3>
              <p className="text-xs text-gray-500 mt-0.5">对话定稿后在此确认并保存</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {!draft ? (
                <p className="text-xs text-gray-400 text-center py-8">
                  继续与助手对话，生成 Skill 后会显示在此
                </p>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={editDraft}
                      onChange={(e) => setEditDraft(e.target.checked)}
                      className="rounded"
                    />
                    编辑草稿后再保存
                  </label>
                  <DraftField label="名称">
                    <input
                      value={draftForm.name}
                      onChange={(e) => setDraftForm((f) => ({ ...f, name: e.target.value }))}
                      disabled={!editDraft}
                      className={draftInputCls + (!editDraft ? " bg-gray-100" : "")}
                    />
                  </DraftField>
                  <DraftField label="描述">
                    <input
                      value={draftForm.description}
                      onChange={(e) => setDraftForm((f) => ({ ...f, description: e.target.value }))}
                      disabled={!editDraft}
                      className={draftInputCls + (!editDraft ? " bg-gray-100" : "")}
                    />
                  </DraftField>
                  <DraftField label="标签">
                    <input
                      value={tagsText}
                      onChange={(e) =>
                        setDraftForm((f) => ({
                          ...f,
                          tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
                        }))
                      }
                      disabled={!editDraft}
                      placeholder="coding, python"
                      className={draftInputCls + (!editDraft ? " bg-gray-100" : "")}
                    />
                  </DraftField>
                  <DraftField label="正文">
                    <textarea
                      rows={8}
                      value={draftForm.content}
                      onChange={(e) => setDraftForm((f) => ({ ...f, content: e.target.value }))}
                      disabled={!editDraft}
                      className={draftInputCls + " font-mono text-xs resize-y" + (!editDraft ? " bg-gray-100" : "")}
                    />
                  </DraftField>
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

function DraftField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

const draftInputCls =
  "w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400";
