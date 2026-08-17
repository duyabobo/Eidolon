import { useCallback, useEffect, useRef, useState } from "react";
import { SkillScope } from "../api/skills";
import { SkillCreatorMessage, SkillDraft, skillCreatorApi } from "../api/skillCreator";
import { useAutoGrowTextarea } from "../hooks/useAutoGrowTextarea";
import ChatMarkdown from "./chat/ChatMarkdown";
import { ModalOverlay } from "./config/ModalOverlay";
import FilePreviewModal, { type FilePreviewSource } from "./FilePreviewModal";
import SkillFolderTree from "./SkillFolderTree";

interface Props {
  scope: SkillScope;
  onClose: () => void;
  onPublished: (skill: {
    name: string;
    description: string;
    tags: string[];
    hidden: boolean;
    scope: SkillScope;
    user_id: string | null;
  }) => void;
  embedded?: boolean;
  /** 编辑已保存的 Skill 时传入 skill 名称，加载对应的历史会话 */
  editSkillName?: string;
}

export default function SkillCreatorChat({
  scope,
  onClose,
  onPublished,
  embedded = false,
  editSkillName,
}: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SkillCreatorMessage[]>([]);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPublished, setIsPublished] = useState(false);
  const [uploads, setUploads] = useState<{ filename: string; relative_path: string; skill_dir: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [treeTick, setTreeTick] = useState(0);
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { textareaRef, syncHeight } = useAutoGrowTextarea(input);

  const scopeLabel = scope === "user" ? "我的 Skill" : "系统 Skill";
  const isEditMode = !!editSkillName;

  const openSession = (forceNew = false, skillName?: string) => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    skillCreatorApi
      .openSession(scope, forceNew, skillName)
      .then((session) => {
        if (cancelled) return;
        setSessionId(session.id);
        setMessages(session.messages);
        setDraft(session.draft ?? null);
        setIsPublished(session.published ?? false);
        setTreeTick((n) => n + 1);
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
  };

  useEffect(() => {
    return openSession(false, editSkillName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, editSkillName]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

  const loadTreeEntries = useCallback(async () => {
    if (!sessionId) return [];
    const res = await skillCreatorApi.getTree(sessionId);
    return res.entries;
  }, [sessionId]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !sessionId || sending) return;

    setInput("");
    requestAnimationFrame(() => syncHeight());
    setSending(true);
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;

    try {
      const res = await skillCreatorApi.sendMessage(sessionId, text, ctrl.signal);
      setMessages((prev) => [...prev, res.message]);
      if (res.draft) {
        setDraft({
          ...res.draft,
          tags: [...(res.draft.tags ?? [])],
          mcp_tools: [...(res.draft.mcp_tools ?? [])],
        });
        setTreeTick((n) => n + 1);
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) {
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

  const handleUpload = async (file: File | undefined) => {
    if (!file || !sessionId || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const res = await skillCreatorApi.uploadFile(sessionId, file);
      setUploads((prev) => [
        ...prev,
        { filename: res.filename, relative_path: res.relative_path, skill_dir: res.skill_dir },
      ]);
      setTreeTick((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
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
        user_id: saved.user_id ?? null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setPublishing(false);
    }
  };

  const panel = (
    <div
      className={`bg-white/95 backdrop-blur-xl rounded-2.5xl shadow-panel w-full flex flex-col border border-ink-200/60 ${
        embedded ? "h-[70vh]" : "max-w-4xl h-[90vh]"
      }`}
    >
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
          {!isPublished && !isEditMode && sessionId && (
            <button
              type="button"
              onClick={() => {
                if (!confirm("确认清除当前对话历史，重新开始？")) return;
                void skillCreatorApi.resetSession(sessionId).then((session) => {
                  setMessages(session.messages);
                  setDraft(null);
                  setInput("");
                  setUploads([]);
                  setTreeTick((n) => n + 1);
                });
              }}
              disabled={loading || sending}
              className="text-xs text-ink-400 hover:text-red-500 disabled:opacity-40 transition-colors"
            >
              重新开始
            </button>
          )}
          {isPublished && !isEditMode && (
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setInput("");
                setUploads([]);
                setIsPublished(false);
                openSession(true);
              }}
              disabled={loading || sending}
              className="text-xs text-ink-400 hover:text-brand-600 disabled:opacity-40 transition-colors"
            >
              新建对话
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-400 hover:text-ink-700 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col border-r min-w-0">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {loading && (
              <p className="text-sm text-gray-400 text-center py-8">正在连接 Skill 创建助手…</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft whitespace-pre-wrap"
                      : "bg-ink-100/80 text-ink-800 border border-ink-200/60"
                  }`}
                >
                  {m.role === "user" ? m.content : <ChatMarkdown content={m.content} />}
                </div>
              </div>
            ))}
            {sending && <p className="text-xs text-gray-400">助手思考中…</p>}
            <div ref={bottomRef} />
          </div>

          {error && (
            <p className="mx-4 mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {uploads.length > 0 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {uploads.map((u) => (
                <span
                  key={`${u.skill_dir}/${u.relative_path}`}
                  className="inline-flex items-center text-xs px-2 py-1 rounded-lg bg-ink-50 text-ink-600 border border-ink-200/60"
                  title={`${u.skill_dir}/${u.relative_path}`}
                >
                  {u.filename}
                </span>
              ))}
            </div>
          )}

          <div className="px-4 py-3 border-t flex gap-2 items-end shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => void handleUpload(e.target.files?.[0])}
            />
            <button
              type="button"
              title="上传附件到 Skill 目录"
              disabled={loading || !sessionId || uploading || sending}
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 self-end text-sm px-2.5 py-1.5 rounded-lg border border-ink-200 text-ink-600 hover:bg-ink-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? "…" : "附件"}
            </button>
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="描述你想创建的 Skill…"
              disabled={loading || !sessionId}
              className="flex-1 resize-none bg-transparent border border-ink-200/80 rounded-xl px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-300 disabled:opacity-60 leading-relaxed"
            />
            {sending ? (
              <button type="button" onClick={handleInterrupt} className="ui-btn-danger shrink-0 self-end">
                中断
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={loading || !sessionId || !input.trim()}
                className="ui-btn-primary shrink-0 self-end"
              >
                发送
              </button>
            )}
          </div>
        </div>

        <div className="w-80 flex flex-col shrink-0 bg-gray-50">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-medium text-gray-700">草稿目录</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {draft?.name ? draft.name : "生成草稿后显示文件树"}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 text-xs min-h-0">
            {!sessionId ? (
              <p className="text-gray-400 text-center py-8">等待会话…</p>
            ) : !draft && uploads.length === 0 ? (
              <p className="text-gray-400 text-center py-8">对话生成 Skill 或上传附件后显示在此</p>
            ) : (
              <SkillFolderTree
                loadEntries={loadTreeEntries}
                refreshKey={`${sessionId}:${draft?.name ?? ""}:${treeTick}`}
                onPreview={(path, filename) =>
                  setPreview({ type: "skill-creator", sessionId, path, filename })
                }
                emptyText="目录尚无文件"
                maxHeightClass="max-h-full"
                className="rounded-lg border border-ink-200/60 bg-white p-2"
              />
            )}
          </div>
          <div className="px-4 py-3 border-t">
            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={!draft || publishing}
              className="w-full ui-btn-primary"
            >
              {publishing ? "保存中…" : "保存 Skill"}
            </button>
          </div>
        </div>
      </div>

      {preview && (
        <FilePreviewModal
          source={preview}
          subtitle={preview.type === "skill-creator" ? "草稿目录" : undefined}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );

  if (embedded) return panel;

  return <ModalOverlay>{panel}</ModalOverlay>;
}
