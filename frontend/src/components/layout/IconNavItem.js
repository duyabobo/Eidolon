import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink } from "react-router-dom";
export default function IconNavItem({ to, label, icon, end = false, onClick, }) {
    return (_jsxs(NavLink, { to: to, end: end, onClick: onClick, "aria-label": label, className: ({ isActive }) => `group relative flex items-center justify-center w-11 h-11 rounded-2xl transition-all duration-200 ${isActive
            ? "bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-md shadow-brand-500/25"
            : "text-ink-500 hover:text-brand-700 hover:bg-white hover:shadow-sm"}`, children: [_jsx("span", { className: "[&>svg]:w-6 [&>svg]:h-6", children: icon }), _jsx("span", { className: "nav-tooltip", role: "tooltip", children: label })] }));
}
