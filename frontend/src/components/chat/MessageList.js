import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
function ThinkingBlock({ content, isStreaming }) {
    const [open, setOpen] = useState(!!isStreaming);
    useEffect(() => { if (isStreaming)
        setOpen(true); }, [isStreaming]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (!isStreaming)
        setOpen(false); }, [isStreaming]);
    return (_jsxs("div", { className: "max-w-[85%] text-xs", children: [_jsxs("button", { type: "button", onClick: () => setOpen((v) => !v), className: "flex items-center gap-1.5 text-ink-400 hover:text-amber-600 transition-colors mb-1.5", children: [_jsx("svg", { className: `w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5l7 7-7 7" }) }), _jsx("span", { className: "italic font-medium", children: isStreaming ? "正在思考…" : "思考过程" }), isStreaming && _jsx("span", { className: "inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" })] }), open && (_jsx("div", { className: "bg-amber-50/80 border border-amber-200/70 rounded-2xl px-3.5 py-2.5 text-ink-500 italic whitespace-pre-wrap break-words leading-relaxed shadow-soft", children: content }))] }));
}
function ToolCallBlock({ content }) {
    const [open, setOpen] = useState(true);
    let name = "";
    let inputText = "";
    try {
        const p = JSON.parse(content);
        name = p.name;
        inputText = JSON.stringify(p.input, null, 2);
    }
    catch {
        inputText = content;
    }
    return (_jsxs("div", { className: "max-w-[85%] text-xs", children: [_jsxs("button", { type: "button", onClick: () => setOpen((v) => !v), className: "flex items-center gap-1.5 text-brand-500 hover:text-brand-700 transition-colors mb-1.5", children: [_jsx("svg", { className: `w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5l7 7-7 7" }) }), _jsx("span", { className: "font-mono font-medium text-brand-600", children: name || "工具调用" })] }), open && _jsx("pre", { className: "bg-brand-50/60 border border-brand-100 rounded-2xl px-3.5 py-2.5 text-ink-600 overflow-x-auto shadow-soft", children: inputText })] }));
}
function ToolResultBlock({ content }) {
    const [open, setOpen] = useState(false);
    let name = "";
    let outputText = "";
    let isError = false;
    try {
        const p = JSON.parse(content);
        name = p.name;
        outputText = p.output;
        isError = !!p.isError;
    }
    catch {
        outputText = content;
    }
    return (_jsxs("div", { className: "max-w-[85%] text-xs", children: [_jsxs("button", { type: "button", onClick: () => setOpen((v) => !v), className: `flex items-center gap-1.5 transition-colors mb-1.5 ${isError ? "text-rose-400 hover:text-rose-600" : "text-emerald-500 hover:text-emerald-700"}`, children: [_jsx("svg", { className: `w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5l7 7-7 7" }) }), _jsx("span", { className: `font-mono font-medium ${isError ? "text-rose-500" : "text-emerald-600"}`, children: name ? `${name} 结果` : "执行结果" })] }), open && (_jsx("pre", { className: `border rounded-2xl px-3.5 py-2.5 overflow-x-auto shadow-soft ${isError ? "bg-rose-50/80 border-rose-100 text-rose-600" : "bg-emerald-50/80 border-emerald-100 text-ink-600"}`, children: outputText }))] }));
}
function PiAvatar() {
    return (_jsx("div", { className: "w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-xs font-semibold shrink-0 mt-0.5 shadow-sm", children: "\u03C0" }));
}
function MessageBubble({ msg }) {
    if (msg.role === "user") {
        return (_jsx("div", { className: "flex justify-end", children: _jsx("div", { className: "max-w-[78%] rounded-2.5xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft", children: msg.content }) }));
    }
    if (msg.type === "thinking") {
        return (_jsxs("div", { className: "flex gap-3 justify-start", children: [_jsx(PiAvatar, {}), _jsx(ThinkingBlock, { content: msg.content, isStreaming: msg.isStreaming })] }));
    }
    if (msg.type === "tool_call") {
        return (_jsxs("div", { className: "flex gap-3 justify-start", children: [_jsx(PiAvatar, {}), _jsx(ToolCallBlock, { content: msg.content })] }));
    }
    if (msg.type === "tool_result") {
        return (_jsxs("div", { className: "flex gap-3 justify-start", children: [_jsx(PiAvatar, {}), _jsx(ToolResultBlock, { content: msg.content })] }));
    }
    return (_jsxs("div", { className: "flex gap-3 justify-start", children: [_jsx(PiAvatar, {}), _jsxs("div", { className: "max-w-[78%] rounded-2.5xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-white/90 backdrop-blur-sm border border-ink-200/60 text-ink-900 shadow-soft", children: [msg.content, msg.isStreaming && _jsx("span", { className: "inline-block w-0.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle rounded-full" })] })] }));
}
export default function MessageList({ messages, bottomRef }) {
    return (_jsx("div", { className: "flex-1 overflow-y-auto scrollbar-thin", children: _jsxs("div", { className: "max-w-3xl mx-auto w-full px-5 py-6 space-y-5", children: [messages.length === 0 && (_jsxs("div", { className: "text-center mt-24 px-4", children: [_jsx("div", { className: "w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-2xl font-bold shadow-soft mb-4", children: "\u03C0" }), _jsx("p", { className: "text-ink-700 font-medium", children: "\u5F00\u59CB\u4E0E Pi Agent \u5BF9\u8BDD" }), _jsx("p", { className: "text-sm text-ink-400 mt-2 leading-relaxed", children: "\u8F93\u5165 / \u53EF\u9009\u62E9 Skill\uFF0CEnter \u53D1\u9001" })] })), messages.map((msg, i) => _jsx(MessageBubble, { msg: msg }, i)), _jsx("div", { ref: bottomRef })] }) }));
}
