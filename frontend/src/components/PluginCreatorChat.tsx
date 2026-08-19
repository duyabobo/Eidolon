import { useCallback, useEffect, useRef, useState } from "react";
import { pluginCreatorApi, type PluginCreatorMessage, type PluginDraft } from "../api/pluginCreator";
import { useAutoGrowTextarea } from "../hooks/useAutoGrowTextarea";
import ChatMarkdown from "./chat/ChatMarkdown";
import { ModalOverlay } from "./config/ModalOverlay";
import FilePreviewModal, { type FilePreviewSource } from "./FilePreviewModal";
import SkillFolderTree from "./SkillFolderTree";

interface Props {
  onClose: () => void;
  onPublished: (plugin: { name: string; description: string }) => void;
  editPluginName?: string;
}

export default function PluginCreatorChat({ onClose, onPublished, editPluginName }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PluginCreatorMessage[]>([]);
  const [draft, setDraft] = useState<PluginDraft | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [treeTick, setTreeTick] = useState(0);
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const { textareaRef, syncHeight } = useAutoGrowTextarea(input);
  const isEditMode = !!editPluginName;

  const openSession = (forceNew = false, pluginName?: string) => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    pluginCreatorApi
      .openSession("user", forceNew, pluginName)
      .then((session) => {
        if (cancelled) return;
        setSessionId(session.id);
        setMessages(session.messages);
        setDraft(session.draft ?? null);
        setTreeTick((n) => n + 1);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "无法启动插件创建助手");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    return openSession(false, editPluginName);
  }, [editPluginName]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

  const loadTreeEntries = useCallback(async () => {
    if (!sessionId) return [];
    const res = await pluginCreatorApi.getTree(sessionId);
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
      const res = await pluginCreatorApi.sendMessage(sessionId, text, ctrl.signal);
      setMessages((prev) => [...prev, res.message]);
      if (res.draft) {
        setDraft(res.draft);
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

  const handlePublish = async () => {
    if (!sessionId || !draft || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const saved = await pluginCreatorApi.publish(sessionId, {});
      onPublished({ name: saved.name, description: saved.description });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setPublishing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <ModalOverlay>
      <div className="bg-white/95 backdrop-blur-xl rounded-2.5xl shadow-panel w-full max-w-4xl h-[90vh] flex flex-col border border-ink-200/60">
        <div className="px-6 py-4 border-b border-ink-200/60 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-ink-900">
              {isEditMode ? `编辑插件：${editPluginName}` : "对话创建本机插件"}
            </h2>
            <p className="text-xs text-ink-400 mt-0.5">
              Agent 帮你写代码，保存后安装到本机并自动登记给 Agent 调用
            </p>
          </div>
          <div className="flex items-center gap-3">
            {sessionId && !isEditMode && (
              <button
                type="button"
                onClick={() => {
                  if (!confirm("确认清除当前对话历史，重新开始？")) return;
                  void pluginCreatorApi.resetSession(sessionId).then((session) => {
                    setMessages(session.messages);
                    setDraft(null);
                    setInput("");
                    setTreeTick((n) => n + 1);
                  });
                }}
                disabled={loading || sending}
                className="text-xs text-ink-400 hover:text-red-500 disabled:opacity-40"
              >
                重新开始
              </button>
            )}
            <button type="button" onClick={onClose} className="text-sm text-ink-400 hover:text-ink-700">
              关闭
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col border-r min-w-0">
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {loading && <p className="text-sm text-gray-400 text-center py-8">正在连接插件创建助手…</p>}
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
            <div className="px-4 py-3 border-t flex gap-2 items-end shrink-0">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="描述你想让插件在本机做什么…"
                disabled={loading || !sessionId}
                className="flex-1 resize-none bg-transparent border border-ink-200/80 rounded-xl px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-300 disabled:opacity-60 leading-relaxed"
              />
              {sending ? (
                <button type="button" onClick={() => abortCtrlRef.current?.abort()} className="ui-btn-danger shrink-0 self-end">
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
              <h3 className="text-sm font-medium text-gray-700">插件目录</h3>
              <p className="text-xs text-gray-500 mt-0.5">{draft?.name ? draft.name : "生成草稿后显示文件"}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 text-xs min-h-0">
              {!sessionId || !draft ? (
                <p className="text-gray-400 text-center py-8">对话生成代码后显示在此</p>
              ) : (
                <SkillFolderTree
                  loadEntries={loadTreeEntries}
                  refreshKey={`${sessionId}:${draft.name}:${treeTick}`}
                  onPreview={(path, filename) =>
                    setPreview({ type: "plugin-creator", sessionId, path, filename })
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
                {publishing ? "安装中…" : "保存并安装到本机"}
              </button>
            </div>
          </div>
        </div>
        {preview && preview.type === "plugin-creator" && (
          <FilePreviewModal
            source={preview}
            subtitle="插件草稿"
            onClose={() => setPreview(null)}
          />
        )}
      </div>
    </ModalOverlay>
  );
}
