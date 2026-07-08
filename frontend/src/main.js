import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import ChatPage from "./pages/ChatPage";
import AdminPage from "./pages/AdminPage";
import "./index.css";
function Layout() {
    return (_jsxs("div", { className: "min-h-screen flex flex-col", children: [_jsxs("nav", { className: "sticky top-0 z-40 border-b border-ink-200/60 bg-white/75 backdrop-blur-xl px-5 py-3 flex items-center gap-5 shadow-sm", children: [_jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx("div", { className: "w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold shadow-sm", children: "\u03C0" }), _jsx("span", { className: "font-semibold text-ink-900 tracking-tight", children: "Pi Agent" })] }), _jsxs("div", { className: "flex items-center gap-1 p-1 rounded-xl bg-ink-100/70", children: [_jsx(NavLink, { to: "/", end: true, className: ({ isActive }) => `text-sm font-medium px-3.5 py-1.5 rounded-lg transition-all duration-200 ${isActive
                                    ? "bg-white text-brand-700 shadow-sm"
                                    : "text-ink-500 hover:text-ink-700"}`, children: "\u5BF9\u8BDD" }), _jsx(NavLink, { to: "/admin", className: ({ isActive }) => `text-sm font-medium px-3.5 py-1.5 rounded-lg transition-all duration-200 ${isActive
                                    ? "bg-white text-brand-700 shadow-sm"
                                    : "text-ink-500 hover:text-ink-700"}`, children: "\u7BA1\u7406" })] })] }), _jsx("main", { className: "flex-1 overflow-hidden", children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(ChatPage, {}) }), _jsx(Route, { path: "/admin", element: _jsx(AdminPage, {}) })] }) })] }));
}
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(BrowserRouter, { children: _jsx(Layout, {}) }) }));
