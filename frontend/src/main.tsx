import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import ChatPage from "./pages/ChatPage";
import AdminPage from "./pages/AdminPage";
import "./index.css";

function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <nav className="sticky top-0 z-40 border-b border-ink-200/60 bg-white/75 backdrop-blur-xl px-5 py-3 flex items-center gap-5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold shadow-sm">
            π
          </div>
          <span className="font-semibold text-ink-900 tracking-tight">Pi Agent</span>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-ink-100/70">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `text-sm font-medium px-3.5 py-1.5 rounded-lg transition-all duration-200 ${
                isActive
                  ? "bg-white text-brand-700 shadow-sm"
                  : "text-ink-500 hover:text-ink-700"
              }`
            }
          >
            对话
          </NavLink>
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `text-sm font-medium px-3.5 py-1.5 rounded-lg transition-all duration-200 ${
                isActive
                  ? "bg-white text-brand-700 shadow-sm"
                  : "text-ink-500 hover:text-ink-700"
              }`
            }
          >
            管理
          </NavLink>
        </div>
      </nav>
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  </React.StrictMode>
);
