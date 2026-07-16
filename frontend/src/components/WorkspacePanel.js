import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceApi } from "../api/workspace";
import { ConfigActionBtn, ConfigPrimaryBtn, ConfigToolbarBtn } from "./config/ConfigActionBtn";
import { ConfigEmptyState, ConfigListToolbar, ConfigPanelLayout, } from "./config/ConfigPanelLayout";
function formatSize(bytes, isDir) {
    if (isDir)
        return "—";
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatMtime(mtime) {
    if (!mtime)
        return "";
    try {
        return new Date(mtime).toLocaleString();
    }
    catch {
        return "";
    }
}
function joinPath(parent, name) {
    if (!parent)
        return name;
    return `${parent}/${name}`;
}
export default function WorkspacePanel({ userId }) {
    const [currentPath, setCurrentPath] = useState("");
    const [listing, setListing] = useState(null);
    const [loading, setLoading] = useState(false);
    const [errMsg, setErrMsg] = useState(null);
    const [mkdirOpen, setMkdirOpen] = useState(false);
    const [newDirName, setNewDirName] = useState("");
    const [busy, setBusy] = useState(false);
    const fileInputRef = useRef(null);
    const uid = userId.trim();
    const load = useCallback(async (path) => {
        if (!uid) {
            setListing(null);
            setErrMsg("请先在右上角「历史」中设置用户 ID");
            return;
        }
        setLoading(true);
        setErrMsg(null);
        try {
            const res = await workspaceApi.ls(uid, path);
            setListing(res);
            setCurrentPath(res.path);
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "加载失败");
        }
        finally {
            setLoading(false);
        }
    }, [uid]);
    useEffect(() => {
        void load("");
    }, [load]);
    const navigateTo = (path) => {
        void load(path);
    };
    const onEntryClick = (entry) => {
        if (entry.name === ".") {
            void load(currentPath);
            return;
        }
        if (entry.is_dir) {
            navigateTo(entry.path);
        }
    };
    const handleUpload = async (file) => {
        if (!file || !listing?.writable)
            return;
        setBusy(true);
        setErrMsg(null);
        try {
            const res = await workspaceApi.upload(uid, currentPath, file);
            setListing(res);
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "上传失败");
        }
        finally {
            setBusy(false);
            if (fileInputRef.current)
                fileInputRef.current.value = "";
        }
    };
    const handleMkdir = async () => {
        const name = newDirName.trim();
        if (!name || !listing?.writable)
            return;
        setBusy(true);
        setErrMsg(null);
        try {
            const target = joinPath(currentPath, name);
            const res = await workspaceApi.mkdir(uid, target);
            setListing(res);
            setMkdirOpen(false);
            setNewDirName("");
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "创建失败");
        }
        finally {
            setBusy(false);
        }
    };
    const handleDelete = async (entry) => {
        if (entry.readonly || entry.name === "." || entry.name === "..")
            return;
        if (!window.confirm(`确认删除「${entry.display_name}」？`))
            return;
        setBusy(true);
        setErrMsg(null);
        try {
            await workspaceApi.delete(uid, entry.path);
            await load(currentPath);
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "删除失败");
        }
        finally {
            setBusy(false);
        }
    };
    const handleDownload = async (entry) => {
        if (entry.is_dir)
            return;
        setBusy(true);
        setErrMsg(null);
        try {
            await workspaceApi.download(uid, entry.path, entry.name);
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "下载失败");
        }
        finally {
            setBusy(false);
        }
    };
    if (!uid) {
        return (_jsx(ConfigEmptyState, { message: "\u8BF7\u5148\u5728\u53F3\u4E0A\u89D2\u300C\u5386\u53F2\u300D\u4E2D\u8BBE\u7F6E\u7528\u6237 ID\uFF0C\u518D\u67E5\u770B\u5DE5\u4F5C\u533A\u6587\u4EF6" }));
    }
    const writable = listing?.writable ?? false;
    const entries = listing?.entries ?? [];
    return (_jsxs(ConfigPanelLayout, { loading: loading && !listing, errMsg: errMsg, toolbar: _jsx(ConfigListToolbar, { left: _jsxs("p", { className: "text-sm text-ink-500 truncate", children: [_jsx("span", { className: "text-ink-400", children: "\u8DEF\u5F84" }), " ", _jsx("span", { className: "font-mono text-ink-700", children: currentPath || "/" }), writable ? (_jsx("span", { className: "ml-2 text-xs text-emerald-600", children: "\u53EF\u8BFB\u5199" })) : (_jsx("span", { className: "ml-2 text-xs text-ink-400", children: "\u53EA\u8BFB" }))] }), right: writable ? (_jsxs(_Fragment, { children: [_jsx("input", { ref: fileInputRef, type: "file", className: "hidden", onChange: (e) => void handleUpload(e.target.files?.[0]) }), _jsx(ConfigToolbarBtn, { disabled: busy, onClick: () => fileInputRef.current?.click(), children: "\u4E0A\u4F20" }), _jsx(ConfigToolbarBtn, { disabled: busy, onClick: () => {
                            setMkdirOpen((v) => !v);
                            setNewDirName("");
                        }, children: "\u65B0\u5EFA\u6587\u4EF6\u5939" }), _jsx(ConfigToolbarBtn, { disabled: busy || loading, onClick: () => void load(currentPath), children: "\u5237\u65B0" })] })) : (_jsx(ConfigToolbarBtn, { disabled: busy || loading, onClick: () => void load(currentPath), children: "\u5237\u65B0" })) }), children: [mkdirOpen && writable && (_jsxs("div", { className: "flex items-center gap-2 p-3 rounded-xl border border-ink-200 bg-ink-50/60", children: [_jsx("input", { className: "flex-1 text-sm px-3 py-1.5 rounded-lg border border-ink-200 bg-white", placeholder: "\u6587\u4EF6\u5939\u540D\u79F0", value: newDirName, onChange: (e) => setNewDirName(e.target.value), onKeyDown: (e) => {
                            if (e.key === "Enter")
                                void handleMkdir();
                        } }), _jsx(ConfigPrimaryBtn, { disabled: busy || !newDirName.trim(), onClick: () => void handleMkdir(), children: "\u521B\u5EFA" }), _jsx(ConfigActionBtn, { onClick: () => setMkdirOpen(false), children: "\u53D6\u6D88" })] })), entries.length === 0 ? (_jsx(ConfigEmptyState, { message: "\u76EE\u5F55\u4E3A\u7A7A" })) : (_jsx("ul", { className: "divide-y divide-ink-100 border border-ink-200/60 rounded-xl overflow-hidden", children: entries.map((entry) => {
                    const isNav = entry.name === "." || entry.name === "..";
                    const clickable = entry.is_dir;
                    return (_jsxs("li", { className: "flex items-center gap-3 px-4 py-2.5 hover:bg-ink-50/80 transition-colors", children: [_jsxs("button", { type: "button", disabled: !clickable, onClick: () => onEntryClick(entry), className: `flex-1 min-w-0 text-left ${clickable ? "cursor-pointer" : "cursor-default"}`, children: [_jsxs("div", { className: "flex items-center gap-2 min-w-0", children: [_jsx("span", { className: "text-ink-400 text-xs w-10 shrink-0 font-mono", children: entry.is_dir ? "dir" : "file" }), _jsx("span", { className: `truncate text-sm ${clickable ? "text-brand-700 font-medium" : "text-ink-800"}`, children: entry.display_name }), entry.readonly && !isNav && (_jsx("span", { className: "text-[10px] px-1.5 py-0.5 rounded bg-ink-100 text-ink-400 shrink-0", children: "\u53EA\u8BFB" }))] }), !isNav && (_jsxs("p", { className: "text-xs text-ink-400 mt-0.5 pl-10", children: [formatSize(entry.size, entry.is_dir), entry.mtime ? ` · ${formatMtime(entry.mtime)}` : ""] }))] }), _jsxs("div", { className: "flex items-center gap-1.5 shrink-0", children: [!entry.is_dir && !isNav && (_jsx(ConfigActionBtn, { disabled: busy, onClick: () => void handleDownload(entry), children: "\u4E0B\u8F7D" })), writable && !entry.readonly && !isNav && (_jsx(ConfigActionBtn, { variant: "danger", disabled: busy, onClick: () => void handleDelete(entry), children: "\u5220\u9664" }))] })] }, `${entry.path}:${entry.name}`));
                }) }))] }));
}
