import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink, useNavigate, useLocation } from "react-router-dom";
import { ChatSessionProvider, useChatSession } from "./context/ChatSessionContext";
import ChatPage from "./pages/ChatPage";
import HistoryPage from "./pages/HistoryPage";
import AdminPage from "./pages/AdminPage";
import "./index.css";
function NavItem({ to, label, icon, onClick, }) {
    return (_jsxs(NavLink, { to: to, end: to === "/", onClick: onClick, className: ({ isActive }) => `flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl transition-all duration-200 ${isActive
            ? "bg-brand-50 text-brand-700"
            : "text-ink-400 hover:text-ink-700 hover:bg-ink-50"}`, children: [icon, _jsx("span", { className: "text-[11px] font-medium", children: label })] }));
}
function Sidebar() {
    const { startNewChat } = useChatSession();
    const navigate = useNavigate();
    const location = useLocation();
    const handleChatClick = () => {
        startNewChat();
        if (location.pathname !== "/")
            navigate("/");
    };
    return (_jsxs("aside", { className: "w-[72px] shrink-0 border-r border-ink-200/60 bg-white/80 backdrop-blur-xl flex flex-col items-center py-4 gap-1", children: [_jsx("div", { className: "w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold shadow-sm mb-4", title: "Pi Agent", children: "\u03C0" }), _jsxs("nav", { className: "flex flex-col gap-0.5 w-full px-2", children: [_jsx(NavItem, { to: "/", label: "\u5BF9\u8BDD", onClick: handleChatClick, icon: _jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.8, d: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" }) }) }), _jsx(NavItem, { to: "/history", label: "\u5386\u53F2", icon: _jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.8, d: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" }) }) }), _jsx(NavItem, { to: "/admin", label: "\u7BA1\u7406", icon: _jsxs("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: [_jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.8, d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" }), _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.8, d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z" })] }) })] })] }));
}
function AppLayout() {
    return (_jsxs("div", { className: "flex h-screen overflow-hidden", children: [_jsx(Sidebar, {}), _jsx("main", { className: "flex-1 min-w-0 overflow-hidden", children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(ChatPage, {}) }), _jsx(Route, { path: "/history", element: _jsx(HistoryPage, {}) }), _jsx(Route, { path: "/admin", element: _jsx(AdminPage, {}) })] }) })] }));
}
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(BrowserRouter, { children: _jsx(ChatSessionProvider, { children: _jsx(AppLayout, {}) }) }) }));
