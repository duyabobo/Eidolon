import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ChatSessionProvider } from "./context/ChatSessionContext";
import ChatPage from "./pages/ChatPage";
import SkillsPage from "./pages/SkillsPage";
import KnowledgePage from "./pages/KnowledgePage";
import McpPage from "./pages/McpPage";
import ConfigPage from "./pages/ConfigPage";
import AppSidebar from "./components/layout/AppSidebar";
import "./index.css";

function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--app-surface)]">
      <AppSidebar />
      <main className="flex-1 min-w-0 overflow-hidden bg-[var(--app-surface)]">
        <Routes>
          <Route path="/" Component={ChatPage} />
          <Route path="/skills" Component={SkillsPage} />
          <Route path="/mcp" Component={McpPage} />
          <Route path="/config" Component={ConfigPage} />
          {/* 知识已融入会话；深链保留兼容，侧栏不再入口 */}
          <Route path="/knowledge" Component={KnowledgePage} />
          <Route path="/knowledge/bases/:kbId" Component={KnowledgePage} />
          <Route path="/knowledge/bases/:kbId/documents/:docId" Component={KnowledgePage} />
          <Route path="/history" element={<Navigate to="/" replace />} />
          <Route path="/llm" element={<Navigate to="/config" replace />} />
          <Route path="/admin" element={<Navigate to="/skills" replace />} />
          <Route path="/admin/knowledge/bases/:kbId" element={<Navigate to="/knowledge/bases/:kbId" replace />} />
          <Route path="/admin/knowledge/bases/:kbId/documents/:docId" element={<Navigate to="/knowledge/bases/:kbId/documents/:docId" replace />} />
          <Route path="/expert-market" element={<Navigate to="/skills" replace />} />
          <Route path="/tool-services" element={<Navigate to="/mcp" replace />} />
        </Routes>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ChatSessionProvider>
        <AppLayout />
      </ChatSessionProvider>
    </BrowserRouter>
  </React.StrictMode>
);
