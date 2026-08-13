import { useLocation, useNavigate } from "react-router-dom";
import { useChatSession } from "../../context/ChatSessionContext";
import { APP_LOGO, APP_NAME } from "../../constants/brand";
import { formatChinaDateTime } from "../../utils/datetime";
import NavItem from "./NavItem";

const PRIMARY_NAV = [
  { to: "/skills", label: "技能" },
  { to: "/mcp", label: "工具" },
  { to: "/config", label: "配置" },
] as const;

export default function AppSidebar() {
  const {
    sessions,
    currentSessionId,
    runtimeTick,
    switchToSession,
    isSessionGenerating,
    startNewChat,
  } = useChatSession();
  const navigate = useNavigate();
  const location = useLocation();

  const openSession = async (sessionId: string) => {
    const session = sessions.find((s) => s.session_id === sessionId);
    if (!session) return;
    await switchToSession(session);
    if (location.pathname !== "/") navigate("/");
  };

  const handleNewChat = () => {
    startNewChat();
    if (location.pathname !== "/") navigate("/");
  };

  const chatActive = location.pathname === "/";

  return (
    <aside className="w-56 shrink-0 border-r border-ink-200/50 bg-[var(--app-sidebar)] flex flex-col">
      <div className="shrink-0 px-3 pt-4 pb-2 space-y-3">
        <div className="flex items-center gap-2 px-1">
          <div
            className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-[11px] font-bold shadow-md shadow-brand-500/20 shrink-0"
            title={APP_NAME}
          >
            {APP_LOGO}
          </div>
          <span className="text-sm font-semibold text-ink-900 truncate">{APP_NAME}</span>
        </div>

        <nav className="flex flex-col gap-0.5">
          {PRIMARY_NAV.map((item) => (
            <NavItem key={item.to} to={item.to} label={item.label} />
          ))}
        </nav>
      </div>

      <div className="mx-3 border-t border-ink-200/60" />

      <div className="flex-1 min-h-0 flex flex-col px-2 pt-3">
        <p className="shrink-0 px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
          会话
        </p>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-0.5">
          {sessions.length === 0 ? (
            <p className="text-xs text-ink-400 px-2 py-6 text-center">暂无历史会话</p>
          ) : (
            sessions.map((s) => {
              const active = s.session_id === currentSessionId && chatActive;
              return (
                <button
                  key={`${s.session_id}-${runtimeTick}`}
                  type="button"
                  onClick={() => void openSession(s.session_id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors ${
                    active
                      ? "bg-[var(--app-surface)] text-ink-900"
                      : "text-ink-600 hover:bg-ink-100/70"
                  }`}
                >
                  <p className="text-xs font-medium truncate leading-snug">{s.request || "未命名会话"}</p>
                  <p className="text-[10px] text-ink-400 mt-0.5 flex items-center gap-1.5">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                        isSessionGenerating(s.session_id)
                          ? "bg-amber-400 animate-pulse"
                          : s.status === "COMPLETED"
                            ? "bg-emerald-400"
                            : s.status === "RUNNING"
                              ? "bg-amber-400"
                              : s.status === "FAILED"
                                ? "bg-rose-400"
                                : "bg-ink-300"
                      }`}
                    />
                    <span className="truncate">{formatChinaDateTime(s.created_at)}</span>
                  </p>
                </button>
              );
            })
          )}
        </div>

        <div className="shrink-0 py-2">
          <button
            type="button"
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-ink-300/80 text-ink-500 hover:border-ink-400 hover:text-ink-700 hover:bg-ink-100/50 transition-colors"
            aria-label="新建会话"
            title="新建会话"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span className="text-xs font-medium">新建会话</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
