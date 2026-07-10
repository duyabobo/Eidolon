import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { knowledgeApi } from "../../api/knowledge";
import { setKnowledgeSceneUid } from "../../api/knowledgeKeyCache";
import { useChatSession } from "../../context/ChatSessionContext";
import WikiMarkdown from "../knowledge/WikiMarkdown";
import { buildWikiNodeMarkdown } from "../knowledge/wikiNodeContent";
import { resolveNodeTitle } from "../knowledge/WikiNodeMeta";
export default function ChatWikiNodeModal({ nodeId, onClose }) {
    const { userId } = useChatSession();
    const [activeNodeId, setActiveNodeId] = useState(nodeId);
    const [node, setNode] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
        setKnowledgeSceneUid(userId);
    }, [userId]);
    const loadNode = useCallback(async (target) => {
        const trimmed = target.trim();
        if (!trimmed)
            return;
        setActiveNodeId(trimmed);
        setLoading(true);
        setError(null);
        setNode(null);
        try {
            const res = await knowledgeApi.getWikiNodeDetail(trimmed);
            setNode(res.node);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "加载 Wiki 节点失败");
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        void loadNode(nodeId);
    }, [nodeId, loadNode]);
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === "Escape")
                onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose]);
    const markdown = node ? buildWikiNodeMarkdown(node) : "";
    const title = node ? resolveNodeTitle(node) : "参考来源";
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-ink-900/30 backdrop-blur-sm p-4", onClick: onClose, role: "presentation", children: _jsxs("div", { className: "bg-white rounded-2xl shadow-panel w-full max-w-2xl border border-ink-200/60 max-h-[85vh] flex flex-col", onClick: (event) => event.stopPropagation(), role: "dialog", "aria-modal": "true", "aria-label": title, children: [_jsxs("div", { className: "flex items-center justify-between px-5 py-4 border-b border-ink-200/60 shrink-0", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h2", { className: "font-semibold text-ink-900 truncate", children: loading ? "加载中…" : title }), node && (_jsxs("p", { className: "text-[11px] text-ink-400 mt-0.5 truncate", children: [node.type || "wiki", " \u00B7 ", activeNodeId.slice(0, 8), "\u2026"] }))] }), _jsx("button", { type: "button", onClick: onClose, className: "text-xs px-2 py-1 border border-ink-200 rounded-lg text-ink-500 hover:bg-ink-50 shrink-0", children: "\u5173\u95ED" })] }), _jsxs("div", { className: "px-5 py-4 overflow-y-auto scrollbar-thin flex-1 min-h-0", children: [loading && _jsx("p", { className: "text-sm text-ink-400", children: "\u52A0\u8F7D\u8282\u70B9\u5185\u5BB9\u2026" }), error && (_jsx("p", { className: "text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700", children: error })), node && !loading && markdown && (_jsx(WikiMarkdown, { content: markdown, onWikiNodeClick: (target) => void loadNode(target) })), node && !loading && !markdown && (_jsx("p", { className: "text-sm text-ink-400", children: "\u8BE5\u8282\u70B9\u6682\u65E0\u6B63\u6587\u5185\u5BB9" }))] })] }) }));
}
