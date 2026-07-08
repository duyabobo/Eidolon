import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useChatSession } from "../context/ChatSessionContext";

export default function HistoryPage() {
  const navigate = useNavigate();
  const {
    userId, setUserId, sessions, currentSessionId,
    runtimeTick, loadSessions, switchToSession, isSessionGenerating, startNewChat,
  } = useChatSession();

  const [editing, setEditing] = useState(false);
  const [draftId, setDraftId] = useState(userId);

  useEffect(() => { if (!editing) setDraftId(userId); }, [userId, editing]);

  const startEdit = () => {
    setDraftId(userId);
    setEditing(true);
  };

  const saveUserId = () => {
    const trimmed = draftId.trim();
    if (trimmed !== userId.trim()) startNewChat();
    setUserId(trimmed);
    setEditing(false);
    if (trimmed) loadSessions();
  };

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
          <h2 className="text-sm font-semibold text-ink-700 mb-3">用户 ID</h2>
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-ink-200/60 shadow-soft p-4">
            {editing ? (
              <div className="flex gap-2">
                <input
                  value={draftId}
                  onChange={(e) => setDraftId(e.target.value)}
                  placeholder="alice"
                  className="ui-field flex-1"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") saveUserId(); }}
                />
                <button type="button" onClick={saveUserId} className="ui-btn-primary">保存</button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-4 py-2.5 text-sm text-ink-500 hover:text-ink-700"
                >
                  取消
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <div>
                  {userId.trim() ? (
                    <p className="text-base font-medium text-ink-900">{userId}</p>
                  ) : (
                    <p className="text-sm text-ink-400">尚未设置，请先填写用户 ID</p>
                  )}
                  <p className="text-xs text-ink-400 mt-1">用于区分个人 Skill、MCP、知识库与对话记录</p>
                </div>
                <button type="button" onClick={startEdit} className="ui-chip bg-ink-50 text-ink-600 border-ink-200/80 hover:bg-ink-100">
                  {userId.trim() ? "修改" : "设置"}
                </button>
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink-700 mb-3">历史对话</h2>
          {!userId.trim() ? (
            <p className="text-sm text-ink-400 text-center py-12 bg-white/60 rounded-2xl border border-dashed border-ink-200">
              请先设置用户 ID
            </p>
          ) : sessions.length === 0 ? (
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
                  className={`w-full text-left px-4 py-3.5 transition-colors hover:bg-brand-50/50 ${
                    s.session_id === currentSessionId ? "bg-brand-50/80" : ""
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
                    <span>
                      {new Date(s.created_at).toLocaleString("zh-CN", {
                        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
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
