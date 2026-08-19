import { useLocation, useNavigate } from "react-router-dom";
import { useChatSession } from "../../context/ChatSessionContext";
import type { SessionSummary } from "../../api/session";
import { APP_LOGO, APP_NAME } from "../../constants/brand";
import { formatChinaDateTime } from "../../utils/datetime";
import NavItem from "./NavItem";

const PRIMARY_NAV = [
  { to: "/skills", label: "经验" },
  { to: "/mcp", label: "插件" },
  { to: "/config", label: "配置" },
] as const;

function sessionStatusDotClass(status: string, generating: boolean): string {
  if (generating) return "bg-amber-400 animate-pulse";
  if (status === "COMPLETED") return "bg-emerald-400";
  if (status === "RUNNING") return "bg-amber-400";
  if (status === "FAILED") return "bg-rose-400";
  return "bg-ink-300";
}

interface SessionListItemProps {
  session: SessionSummary;
  active: boolean;
  generating: boolean;
  onOpen: (sessionId: string) => void;
}

function SessionListItem({
  session,
  active,
  generating,
  onOpen,
}: SessionListItemProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(session.session_id)}
      className={`w-full text-left px-2.5 py-2.5 rounded-xl transition-colors ${
        active
          ? "bg-[var(--app-surface)] text-ink-900"
          : "text-ink-600 hover:bg-ink-100/70"
      }`}
    >
      <p className="text-xs font-medium truncate leading-snug">
        {session.request || "未命名会话"}
      </p>
      <p className="text-[10px] text-ink-400 mt-1 flex items-center gap-1.5">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${sessionStatusDotClass(session.status, generating)}`}
        />
        <span className="truncate">{formatChinaDateTime(session.created_at)}</span>
      </p>
    </button>
  );
}

export default function AppSidebar() {
  const {
    sessions,
    currentSessionId,
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
    <aside className="w-56 shrink-0 h-full border-r border-ink-200/50 bg-[var(--app-sidebar)] flex flex-col">
      <header className="shrink-0 px-3 pt-5 pb-4">
        <div className="flex items-center gap-2.5 px-1">
          <div
            className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-[11px] font-bold shadow-md shadow-brand-500/20 shrink-0"
            title={APP_NAME}
          >
            {APP_LOGO}
          </div>
          <span className="text-sm font-semibold text-ink-900 truncate">{APP_NAME}</span>
        </div>

        <button
          type="button"
          onClick={handleNewChat}
          className="mt-5 w-full h-9 flex items-center justify-center gap-1.5 rounded-xl bg-white text-ink-700 text-xs font-medium border border-ink-200/80 shadow-sm hover:border-ink-300 hover:text-ink-900 hover:shadow transition-all"
          aria-label="新建会话"
          title="新建会话"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span>新建会话</span>
        </button>
      </header>

      <section className="flex-1 min-h-0 flex flex-col px-3">
        <p className="shrink-0 px-2.5 pb-2 text-[11px] text-ink-400">历史</p>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-1 pb-4">
          {sessions.length === 0 ? (
            <p className="text-xs text-ink-400 px-2.5 py-10 text-center leading-relaxed">
              暂无历史会话
            </p>
          ) : (
            sessions.map((session) => (
              <SessionListItem
                key={session.session_id}
                session={session}
                active={session.session_id === currentSessionId && chatActive}
                generating={isSessionGenerating(session.session_id)}
                onOpen={(sessionId) => { void openSession(sessionId); }}
              />
            ))
          )}
        </div>
      </section>

      <nav className="shrink-0 border-t border-ink-200/60 px-3 pt-3 pb-5 flex flex-col gap-0.5">
        {PRIMARY_NAV.map((item) => (
          <NavItem key={item.to} to={item.to} label={item.label} />
        ))}
      </nav>
    </aside>
  );
}
