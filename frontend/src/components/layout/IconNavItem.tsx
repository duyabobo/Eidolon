import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";

interface IconNavItemProps {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  onClick?: () => void;
}

export default function IconNavItem({
  to, label, icon, end = false, onClick,
}: IconNavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      aria-label={label}
      className={({ isActive }) =>
        `group relative flex items-center justify-center w-11 h-11 rounded-2xl transition-all duration-200 ${
          isActive
            ? "bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-md shadow-brand-500/25"
            : "text-ink-500 hover:text-brand-700 hover:bg-white hover:shadow-sm"
        }`
      }
    >
      <span className="[&>svg]:w-6 [&>svg]:h-6">{icon}</span>
      <span className="nav-tooltip" role="tooltip">{label}</span>
    </NavLink>
  );
}
