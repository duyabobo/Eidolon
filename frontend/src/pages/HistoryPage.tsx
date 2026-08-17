import { useNavigate } from "react-router-dom";
import { useChatSession } from "../context/ChatSessionContext";
import { formatChinaDateTime } from "../utils/datetime";

export default function HistoryPage() {
  const navigate = useNavigate();
  const {
    sessions, currentSessionId,
    runtimeTick, switchToSession, isSessionGenerating,
  } = useChatSession();

  const openSession = async (sessionId: string) => {
    const session = sessions.find((s) => s.session_id === sessionId);
    if (!session) return;
    await switchToSession(session);
    navigate("/");
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="page-content py-8 space-y-8">
        <section>
          <h2 className="text-sm font-semibold text-ink-700 mb-3">历史对话</h2>
          {sessions.length === 0 ? (
            <p className="text-sm text-ink-400 text-center py-12 bg-white/60 rounded-2xl border border-dashed border-ink-200">
              暂无历史对话
            </p>
          ) : (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-ink-200/60 shadow-soft overflow-hidden divide-y divide-ink-100">
              {sessions.map((s) => (
                <button
                  key={`${s.session_id}-${runtimeTick}`}
                  type="button"
                  onClick={() => openSession(s.session_id)}
                  className={`w-full text-left px-4 py-3.5 transition-colors hover:bg-ink-100/60 ${
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
    </div>
  );
}
