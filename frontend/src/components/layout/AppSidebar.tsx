import { useLocation, useNavigate } from "react-router-dom";
import { useChatSession } from "../../context/ChatSessionContext";
import { APP_LOGO, APP_NAME } from "../../constants/brand";
import NavItem from "./NavItem";

const NAV_ITEMS = [
  { to: "/skills", label: "技能" },
  { to: "/mcp", label: "工具" },
  { to: "/knowledge", label: "知识" },
  { to: "/llm", label: "模型" },
  { to: "/workspace", label: "文件" },
] as const;

export default function AppSidebar() {
  const { resumeLastChat } = useChatSession();
  const navigate = useNavigate();
  const location = useLocation();

  const handleChatClick = () => {
    void resumeLastChat();
    if (location.pathname !== "/") navigate("/");
  };

  return (
    <aside className="w-44 shrink-0 border-r border-ink-200/60 bg-white/80 backdrop-blur-xl flex flex-col py-4 px-3 gap-1">
      <div className="flex items-center gap-2 px-1 pb-3 mb-1">
        <div
          className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-[11px] font-bold shadow-md shadow-brand-500/20 shrink-0"
          title={APP_NAME}
        >
          {APP_LOGO}
        </div>
        <span className="text-sm font-semibold text-ink-900 truncate">{APP_NAME}</span>
      </div>

      <nav className="flex flex-col gap-1">
        <NavItem to="/" end label="对话" onClick={handleChatClick} />
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} to={item.to} label={item.label} />
        ))}
      </nav>
    </aside>
  );
}
