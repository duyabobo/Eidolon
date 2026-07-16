import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ChatSessionProvider } from "./context/ChatSessionContext";
import ChatPage from "./pages/ChatPage";
import SkillsPage from "./pages/SkillsPage";
import KnowledgePage from "./pages/KnowledgePage";
import McpPage from "./pages/McpPage";
import WorkspacePage from "./pages/WorkspacePage";
import LlmPage from "./pages/LlmPage";
import AppSidebar from "./components/layout/AppSidebar";
import "./index.css";
function AppLayout() {
    return (_jsxs("div", { className: "flex h-screen overflow-hidden", children: [_jsx(AppSidebar, {}), _jsx("main", { className: "flex-1 min-w-0 overflow-hidden", children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(ChatPage, {}) }), _jsx(Route, { path: "/skills", element: _jsx(SkillsPage, {}) }), _jsx(Route, { path: "/knowledge", element: _jsx(KnowledgePage, {}) }), _jsx(Route, { path: "/knowledge/bases/:kbId", element: _jsx(KnowledgePage, {}) }), _jsx(Route, { path: "/knowledge/bases/:kbId/documents/:docId", element: _jsx(KnowledgePage, {}) }), _jsx(Route, { path: "/mcp", element: _jsx(McpPage, {}) }), _jsx(Route, { path: "/workspace", element: _jsx(WorkspacePage, {}) }), _jsx(Route, { path: "/llm", element: _jsx(LlmPage, {}) }), _jsx(Route, { path: "/history", element: _jsx(Navigate, { to: "/", replace: true }) }), _jsx(Route, { path: "/admin", element: _jsx(Navigate, { to: "/skills", replace: true }) }), _jsx(Route, { path: "/admin/knowledge/bases/:kbId", element: _jsx(Navigate, { to: "/knowledge/bases/:kbId", replace: true }) }), _jsx(Route, { path: "/admin/knowledge/bases/:kbId/documents/:docId", element: _jsx(Navigate, { to: "/knowledge/bases/:kbId/documents/:docId", replace: true }) })] }) })] }));
}
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(BrowserRouter, { children: _jsx(ChatSessionProvider, { children: _jsx(AppLayout, {}) }) }) }));
