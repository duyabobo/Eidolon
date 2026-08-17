import { useEffect } from "react";
import { useChatSession } from "../../context/ChatSessionContext";
import { formatChinaDateTime } from "../../utils/datetime";

interface ChatHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function ChatHistoryDrawer({ open, onClose }: ChatHistoryDrawerProps) {
  const {
    sessions, currentSessionId,
    runtimeTick, switchToSession, isSessionGenerating,
  } = useChatSession();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const openSession = async (sessionId: string) => {
    const session = sessions.find((s) => s.session_id === sessionId);
    if (!session) return;
    await switchToSession(session);
    onClose();
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-ink-900/20 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`fixed top-0 right-0 bottom-0 z-50 w-full max-w-sm bg-white/95 backdrop-blur-xl border-l border-ink-200/80 shadow-panel flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <h2 className="text-base font-semibold text-ink-900">历史对话</h2>
          <button
            type="button"
            onClick={onClose}
            className="ui-icon-btn"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-6">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-2">会话列表</h3>
            {sessions.length === 0 ? (
              <p className="text-sm text-ink-400 text-center py-10 rounded-xl border border-dashed border-ink-200">
                暂无历史对话
              </p>
            ) : (
              <div className="rounded-xl border border-ink-200/70 overflow-hidden divide-y divide-ink-100">
                {sessions.map((s) => (
                  <button
                    key={`${s.session_id}-${runtimeTick}`}
                    type="button"
                    onClick={() => openSession(s.session_id)}
                    className={`w-full text-left px-3.5 py-3 transition-colors hover:bg-ink-100/60 ${
                      s.session_id === currentSessionId ? "bg-ink-200/70" : ""
                    }`}
                  >
                    <p className="text-sm text-ink-800 truncate leading-snug">{s.request}</p>
                    <p className="text-xs text-ink-400 mt-1 flex items-center gap-2">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                        isSessionGenerating(s.session_id) ? "bg-amber-400 animate-pulse" :
                        s.status === "COMPLETED" ? "bg-emerald-400" :
                        s.status === "RUNNING" ? "bg-amber-400" :
                        s.status === "FAILED" ? "bg-rose-400" : "bg-ink-300"
                      }`} />
                      <span>{formatChinaDateTime(s.created_at)}</span>
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
