import { NavLink } from "react-router-dom";

interface NavItemProps {
  to: string;
  label: string;
  end?: boolean;
  onClick?: () => void;
}

/** 纯文字导航项（无 icon）：选中态用淡灰色背景 + 深色文字，不用品牌色，保持克制。 */
export default function NavItem({ to, label, end = false, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150 ${
          isActive
            ? "bg-ink-200/70 text-ink-900"
            : "text-ink-500 hover:bg-ink-100/70 hover:text-ink-700"
        }`
      }
    >
      {label}
    </NavLink>
  );
}
