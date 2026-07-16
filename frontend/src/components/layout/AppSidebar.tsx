import { useLocation, useNavigate } from "react-router-dom";
import { useChatSession } from "../../context/ChatSessionContext";
import { APP_LOGO, APP_NAME } from "../../constants/brand";
import IconNavItem from "./IconNavItem";

const NAV_ITEMS = [
  {
    to: "/skills",
    label: "技能",
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
      </svg>
    ),
  },
  {
    to: "/knowledge",
    label: "知识",
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    to: "/mcp",
    label: "工具",
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
      </svg>
    ),
  },
  {
    to: "/workspace",
    label: "文件",
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V6A2.25 2.25 0 014.5 3.75h4.379a2.25 2.25 0 011.59.659l2.122 2.122a2.25 2.25 0 001.59.659H19.5A2.25 2.25 0 0121.75 9v10.5A2.25 2.25 0 0119.5 21.75h-15a2.25 2.25 0 01-2.25-2.25z" />
      </svg>
    ),
  },
  {
    to: "/llm",
    label: "模型",
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
      </svg>
    ),
  },
] as const;

export default function AppSidebar() {
  const { startNewChat } = useChatSession();
  const navigate = useNavigate();
  const location = useLocation();

  const handleChatClick = () => {
    startNewChat();
    if (location.pathname !== "/") navigate("/");
  };

  return (
    <aside className="w-[68px] shrink-0 border-r border-ink-200/60 bg-white/80 backdrop-blur-xl flex flex-col items-center py-4 gap-3">
      <div
        className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold shadow-md shadow-brand-500/20"
        title={APP_NAME}
      >
        {APP_LOGO}
      </div>

      <nav className="flex flex-col items-center gap-2">
        <IconNavItem
          to="/"
          end
          label="对话"
          onClick={handleChatClick}
          icon={(
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v11.18z" />
            </svg>
          )}
        />
        {NAV_ITEMS.map((item) => (
          <IconNavItem key={item.to} to={item.to} label={item.label} icon={item.icon} />
        ))}
      </nav>
    </aside>
  );
}
