import { NavLink } from "react-router-dom";

interface NavItemProps {
  to: string;
  label: string;
  end?: boolean;
  onClick?: () => void;
}

/** 选中态背景与右侧主内容区 --app-surface 一致，形成连续面。 */
export default function NavItem({ to, label, end = false, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
          isActive
            ? "bg-[var(--app-surface)] text-ink-900"
            : "text-ink-500 hover:bg-ink-100/80 hover:text-ink-700"
        }`
      }
    >
      {label}
    </NavLink>
  );
}
