import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { toSkillRef } from "../api/skills";
import { workspaceApi } from "../api/workspace";
import { useAutoGrowTextarea } from "../hooks/useAutoGrowTextarea";
function detectSlash(input, cursorPos) {
    const before = input.slice(0, cursorPos);
    const match = before.match(/(?:^|\s)\/([^\s/]*)$/);
    if (!match)
        return null;
    return { query: match[1] ?? "", start: before.lastIndexOf("/") };
}
function SkillScopeBadge({ scope }) {
    const isUser = scope === "user";
    return (_jsx("span", { className: `text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isUser ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"}`, children: isUser ? "我的" : "系统" }));
}
export default function ChatInput({ skills, selectedSkillRef, onSelectSkill, onClearSkill, isLoading, onSend, onInterrupt, userId, sessionId, onUploaded, }) {
    const [input, setInput] = useState("");
    const [cursorPos, setCursorPos] = useState(0);
    const [menuIndex, setMenuIndex] = useState(0);
    const [pendingFiles, setPendingFiles] = useState([]);
    const [uploadErr, setUploadErr] = useState(null);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef(null);
    const prevSessionIdRef = useRef(sessionId);
    const { textareaRef, syncHeight } = useAutoGrowTextarea(input);
    const canPickFile = Boolean(userId.trim()) && !isLoading && !uploading;
    useEffect(() => {
        const prev = prevSessionIdRef.current;
        prevSessionIdRef.current = sessionId;
        if (prev === sessionId)
            return;
        // 离开会话或切换会话：清空挂起（发送路径会自行上传 pending）
        setPendingFiles([]);
        setUploadErr(null);
    }, [sessionId]);
    const slashCtx = useMemo(() => detectSlash(input, cursorPos), [input, cursorPos]);
    const menuOpen = slashCtx !== null;
    const filteredSkills = useMemo(() => {
        if (!slashCtx)
            return [];
        const q = slashCtx.query.toLowerCase();
        return skills.filter((s) => {
            const scope = s.scope ?? "system";
            const ref = toSkillRef(scope, s.name);
            if (selectedSkillRef === ref)
                return false;
            return !q || s.name.toLowerCase().includes(q);
        });
    }, [slashCtx, skills, selectedSkillRef]);
    const selectedSkill = useMemo(() => skills.find((s) => toSkillRef(s.scope ?? "system", s.name) === selectedSkillRef), [skills, selectedSkillRef]);
    const applySkill = useCallback((skill) => {
        const scope = skill.scope ?? "system";
        const ref = toSkillRef(scope, skill.name);
        onSelectSkill(ref);
        if (slashCtx) {
            const before = input.slice(0, slashCtx.start);
            const after = input.slice(cursorPos);
            const trimmedBefore = before.replace(/\s$/, "");
            setInput(trimmedBefore + after);
            setCursorPos(trimmedBefore.length);
        }
        setMenuIndex(0);
        textareaRef.current?.focus();
    }, [slashCtx, input, cursorPos, onSelectSkill, textareaRef]);
    const handleSend = () => {
        const trimmed = input.trim();
        if (!trimmed || isLoading)
            return;
        const files = pendingFiles.map((p) => p.file);
        setPendingFiles([]);
        setUploadErr(null);
        onSend(trimmed, files);
        setInput("");
        setMenuIndex(0);
        requestAnimationFrame(() => syncHeight());
    };
    const handleKeyDown = (e) => {
        if (menuOpen && filteredSkills.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setMenuIndex((i) => (i + 1) % filteredSkills.length);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setMenuIndex((i) => (i - 1 + filteredSkills.length) % filteredSkills.length);
                return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                applySkill(filteredSkills[menuIndex]);
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                if (slashCtx) {
                    const before = input.slice(0, slashCtx.start);
                    const after = input.slice(cursorPos);
                    setInput(before + after);
                    setCursorPos(before.length);
                }
                return;
            }
        }
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSend();
        }
    };
    const syncCursor = () => {
        const el = textareaRef.current;
        if (el)
            setCursorPos(el.selectionStart);
    };
    const handleUpload = async (file) => {
        if (!file || !userId.trim()) {
            setUploadErr("请先在「历史」页设置用户 ID");
            return;
        }
        setUploadErr(null);
        if (!sessionId) {
            setPendingFiles((prev) => [...prev, { id: crypto.randomUUID(), file }]);
            if (fileInputRef.current)
                fileInputRef.current.value = "";
            return;
        }
        setUploading(true);
        try {
            const res = await workspaceApi.uploadToSession(userId, sessionId, file);
            onUploaded?.(res);
        }
        catch (e) {
            setUploadErr(e instanceof Error ? e.message : "上传失败");
        }
        finally {
            setUploading(false);
            if (fileInputRef.current)
                fileInputRef.current.value = "";
        }
    };
    const removePending = (id) => {
        setPendingFiles((prev) => prev.filter((p) => p.id !== id));
    };
    return (_jsxs("div", { className: "relative", children: [menuOpen && filteredSkills.length > 0 && (_jsxs("div", { className: "absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl border border-ink-200/80 shadow-panel overflow-hidden z-10", children: [_jsx("p", { className: "text-[11px] text-ink-400 px-3 py-2 border-b border-ink-100", children: "\u9009\u62E9 Skill" }), _jsx("ul", { className: "max-h-48 overflow-y-auto scrollbar-thin py-1", children: filteredSkills.map((s, i) => {
                            const scope = s.scope ?? "system";
                            return (_jsx("li", { children: _jsxs("button", { type: "button", onMouseDown: (e) => { e.preventDefault(); applySkill(s); }, className: `w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${i === menuIndex ? "bg-brand-50" : "hover:bg-ink-50"}`, children: [_jsxs("span", { className: "text-sm font-medium text-ink-800", children: ["/", s.name] }), _jsx(SkillScopeBadge, { scope: scope }), s.description && (_jsx("span", { className: "text-xs text-ink-400 truncate flex-1", children: s.description }))] }) }, toSkillRef(scope, s.name)));
                        }) })] })), selectedSkill && (_jsx("div", { className: "flex items-center gap-2 mb-2", children: _jsxs("span", { className: "inline-flex items-center gap-1.5 text-xs bg-brand-50 text-brand-700 border border-brand-200/60 rounded-full px-2.5 py-1", children: [_jsx(SkillScopeBadge, { scope: selectedSkill.scope ?? "system" }), _jsxs("span", { className: "font-medium", children: ["/", selectedSkill.name] }), _jsx("button", { type: "button", onClick: onClearSkill, className: "text-brand-400 hover:text-brand-700 ml-0.5", "aria-label": "\u6E05\u9664 Skill", children: "\u00D7" })] }) })), pendingFiles.length > 0 && (_jsx("div", { className: "flex flex-wrap gap-1.5 mb-2", children: pendingFiles.map((p) => (_jsxs("span", { className: "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200/70", title: "\u53D1\u9001\u6D88\u606F\u521B\u5EFA\u4F1A\u8BDD\u540E\u81EA\u52A8\u4E0A\u4F20", children: [p.file.name, _jsx("span", { className: "text-[10px] opacity-70", children: "\u5F85\u4E0A\u4F20" }), _jsx("button", { type: "button", className: "text-amber-500 hover:text-amber-800", onClick: () => removePending(p.id), "aria-label": "\u79FB\u9664", children: "\u00D7" })] }, p.id))) })), uploadErr && (_jsx("p", { className: "text-xs text-rose-600 mb-2", children: uploadErr })), _jsxs("div", { className: "flex gap-3 items-end rounded-2xl border border-ink-200/80 bg-white/90 p-2 shadow-soft focus-within:ring-2 focus-within:ring-brand-500/20 focus-within:border-brand-300 transition-all duration-200", children: [_jsx("input", { ref: fileInputRef, type: "file", className: "hidden", onChange: (e) => void handleUpload(e.target.files?.[0]) }), _jsx("button", { type: "button", title: !userId.trim()
                            ? "请先在「历史」页设置用户 ID"
                            : sessionId
                                ? "上传附件到当前会话"
                                : "选择附件（发送消息创建会话后自动上传）", disabled: !canPickFile, onClick: () => fileInputRef.current?.click(), className: "shrink-0 self-end text-sm px-2.5 py-1.5 rounded-lg border border-ink-200 text-ink-600 hover:bg-ink-50 disabled:opacity-40 disabled:cursor-not-allowed", children: uploading ? "…" : "附件" }), _jsx("textarea", { ref: textareaRef, value: input, onChange: (e) => { setInput(e.target.value); setMenuIndex(0); }, onKeyDown: handleKeyDown, onKeyUp: syncCursor, onClick: syncCursor, onSelect: syncCursor, placeholder: "\u8F93\u5165\u6D88\u606F\u2026  \u8F93\u5165 / \u9009\u62E9 Skill", rows: 1, disabled: isLoading, className: "flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:opacity-60 leading-relaxed" }), isLoading ? (_jsx("button", { type: "button", onClick: onInterrupt, className: "ui-btn-danger shrink-0 self-end", children: "\u4E2D\u65AD" })) : (_jsx("button", { type: "button", onClick: handleSend, disabled: !input.trim(), className: "ui-btn-primary shrink-0 self-end", children: "\u53D1\u9001" }))] })] }));
}
