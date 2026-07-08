import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { knowledgeApi, ensureKnowledgeKey, formatFileSize, docStatusLabel, } from "../api/knowledge";
import { setKnowledgeSceneUid } from "../api/knowledgeKeyCache";
import DocumentWikiExplorer from "./knowledge/DocumentWikiExplorer";
const EMPTY_SERVICE = { base_url: "", environment: "local" };
function KnowledgeServiceSection({ userId, onSaved, }) {
    const [form, setForm] = useState(EMPTY_SERVICE);
    const [envOptions, setEnvOptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState(null);
    const loadConfig = useCallback(async () => {
        const [cfg, envs] = await Promise.all([
            knowledgeApi.getServiceConfig(),
            knowledgeApi.listServiceEnvironments(),
        ]);
        setForm(cfg);
        setEnvOptions(envs.items);
        setKnowledgeSceneUid(userId.trim());
    }, [userId]);
    useEffect(() => {
        loadConfig()
            .catch(() => setForm(EMPTY_SERVICE))
            .finally(() => setLoading(false));
    }, [loadConfig]);
    const handleEnvironmentChange = async (environment) => {
        if (!environment || environment === form.environment)
            return;
        if (environment !== "local" && !userId.trim()) {
            setMsg({ type: "err", text: "请先在「历史」页设置用户 ID" });
            return;
        }
        setSaving(true);
        setMsg(null);
        try {
            const saved = await knowledgeApi.saveServiceConfig({ environment, base_url: "" });
            setForm(saved);
            await onSaved(saved);
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "切换失败" });
        }
        finally {
            setSaving(false);
        }
    };
    const currentEnv = form.environment ?? "local";
    return (_jsx("div", { className: "border border-ink-200/60 rounded-xl p-4 bg-ink-50/40", children: loading ? (_jsx("p", { className: "text-sm text-ink-400", children: "\u52A0\u8F7D\u914D\u7F6E\u2026" })) : (_jsxs(_Fragment, { children: [_jsx("select", { value: currentEnv, disabled: saving, onChange: (e) => void handleEnvironmentChange(e.target.value), className: "ui-field w-full", children: (envOptions.length ? envOptions : [
                        { id: "local", label: "本地", base_url: "" },
                        { id: "prod", label: "线上", base_url: "" },
                        { id: "test", label: "测试", base_url: "" },
                    ]).map((opt) => (_jsx("option", { value: opt.id, children: opt.label }, opt.id))) }), msg?.type === "err" && (_jsx("p", { className: "text-sm px-3 py-2 rounded-lg mt-3 bg-rose-50 text-rose-700", children: msg.text }))] })) }));
}
function StatusBadge({ status }) {
    const cls = {
        uploaded: "bg-sky-50 text-sky-700",
        processing: "bg-amber-50 text-amber-700",
        indexed: "bg-emerald-50 text-emerald-700",
        failed: "bg-rose-50 text-rose-700",
    }[status];
    return (_jsx("span", { className: `text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cls}`, children: docStatusLabel(status) }));
}
function BaseForm({ initial, onSubmit, onCancel, submitLabel, }) {
    const [name, setName] = useState(initial?.name ?? "");
    const [description, setDescription] = useState(initial?.description ?? "");
    return (_jsxs("div", { className: "border border-ink-200/60 rounded-xl p-4 space-y-3 bg-ink-50/30", children: [_jsx("input", { value: name, onChange: (e) => setName(e.target.value), placeholder: "\u77E5\u8BC6\u5E93\u540D\u79F0", className: "ui-field w-full", autoFocus: true }), _jsx("textarea", { value: description, onChange: (e) => setDescription(e.target.value), placeholder: "\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09", rows: 2, className: "ui-field w-full resize-none" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", disabled: !name.trim(), onClick: () => onSubmit(name.trim(), description.trim()), className: "ui-btn-primary flex-1", children: submitLabel }), _jsx("button", { type: "button", onClick: onCancel, className: "flex-1 py-2.5 text-sm border border-ink-200 rounded-xl", children: "\u53D6\u6D88" })] })] }));
}
const DOC_POLL_INTERVAL_MS = 10000;
const TERMINAL_DOC_STATUSES = ["indexed", "failed"];
function isPendingDocument(status) {
    return !TERMINAL_DOC_STATUSES.includes(status);
}
function DocumentSection({ kb, deepLinkDocId, }) {
    const navigate = useNavigate();
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [errMsg, setErrMsg] = useState(null);
    const [wikiDoc, setWikiDoc] = useState(null);
    const [wikiLoading, setWikiLoading] = useState(false);
    const fileRef = useRef(null);
    const openWiki = useCallback((doc) => {
        setWikiDoc(doc);
        navigate(`/admin/knowledge/bases/${encodeURIComponent(kb.id)}/documents/${encodeURIComponent(doc.id)}`);
    }, [kb.id, navigate]);
    const closeWiki = useCallback(() => {
        setWikiDoc(null);
        navigate("/admin?tab=knowledge");
    }, [navigate]);
    const load = useCallback((silent = false) => {
        if (!silent)
            setLoading(true);
        return knowledgeApi.listDocuments(kb.id)
            .then((res) => setDocs(res.items))
            .catch(() => {
            if (!silent)
                setDocs([]);
        })
            .finally(() => {
            if (!silent)
                setLoading(false);
        });
    }, [kb.id]);
    useEffect(() => { void load(); }, [load]);
    const hasPendingDocs = docs.some((doc) => isPendingDocument(doc.status));
    useEffect(() => {
        if (!hasPendingDocs)
            return;
        const timer = setInterval(() => void load(true), DOC_POLL_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [hasPendingDocs, load]);
    useEffect(() => {
        if (!deepLinkDocId)
            return;
        const fromList = docs.find((doc) => doc.id === deepLinkDocId);
        if (fromList) {
            setWikiDoc(fromList);
            return;
        }
        setWikiLoading(true);
        knowledgeApi.getDocument(kb.id, deepLinkDocId)
            .then(setWikiDoc)
            .catch(() => {
            setWikiDoc(null);
            setErrMsg("文档不存在或无法加载");
        })
            .finally(() => setWikiLoading(false));
    }, [deepLinkDocId, docs, kb.id]);
    const handleUpload = async (files) => {
        if (!files?.length)
            return;
        setUploading(true);
        setErrMsg(null);
        try {
            for (const file of Array.from(files)) {
                await knowledgeApi.uploadDocument(kb.id, file);
            }
            setErrMsg(null);
            await load();
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "上传失败");
        }
        finally {
            setUploading(false);
            if (fileRef.current)
                fileRef.current.value = "";
        }
    };
    const handleDelete = async (doc) => {
        if (!confirm(`确认删除文档「${doc.name}」？`))
            return;
        await knowledgeApi.deleteDocument(kb.id, doc.id);
        if (wikiDoc?.id === doc.id)
            closeWiki();
        load();
    };
    if (wikiLoading) {
        return _jsx("p", { className: "text-sm text-ink-400", children: "\u52A0\u8F7D\u6587\u6863\u2026" });
    }
    if (wikiDoc) {
        return (_jsx(DocumentWikiExplorer, { kbId: kb.id, doc: wikiDoc, onBack: closeWiki }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs text-ink-400 mt-0.5", children: kb.description || "暂无描述" }), _jsx("p", { className: "text-[11px] text-ink-400 mt-1", children: "\u652F\u6301 pdf / docx / txt / md / csv / xlsx / pptx\uFF0C\u5355\u6587\u4EF6 \u2264 10MB \u00B7 \u70B9\u51FB\u6587\u6863\u67E5\u770B Wiki \u77E5\u8BC6\u56FE\u8C31" })] }), _jsxs("div", { children: [_jsx("input", { ref: fileRef, type: "file", multiple: true, accept: ".pdf,.docx,.txt,.md,.csv,.xlsx,.pptx", className: "hidden", onChange: (e) => handleUpload(e.target.files) }), _jsx("button", { type: "button", disabled: uploading, onClick: () => fileRef.current?.click(), className: "ui-btn-primary text-sm", children: uploading ? "上传中…" : "上传文档" })] })] }), errMsg && (_jsx("p", { className: "text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700", children: errMsg })), loading ? (_jsx("p", { className: "text-sm text-ink-400", children: "\u52A0\u8F7D\u6587\u6863\u2026" })) : docs.length === 0 ? (_jsx("p", { className: "text-sm text-ink-400 text-center py-10 border border-dashed border-ink-200 rounded-xl", children: "\u6682\u65E0\u6587\u6863\uFF0C\u70B9\u51FB\u300C\u4E0A\u4F20\u6587\u6863\u300D\u6DFB\u52A0" })) : (_jsx("div", { className: "space-y-2", children: docs.map((doc) => (_jsxs("div", { className: "flex items-center gap-3 border border-ink-200/60 rounded-xl px-4 py-3", children: [_jsxs("button", { type: "button", onClick: () => openWiki(doc), className: "flex-1 min-w-0 text-left hover:opacity-80 transition-opacity", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "text-sm font-medium text-ink-800 truncate", children: doc.name }), _jsx(StatusBadge, { status: doc.status })] }), _jsxs("p", { className: "text-xs text-ink-400 mt-0.5", children: [formatFileSize(doc.file_size), " \u00B7 ", new Date(doc.created_at).toLocaleString("zh-CN")] })] }), _jsxs("div", { className: "flex gap-2 shrink-0", children: [_jsx("button", { type: "button", onClick: () => openWiki(doc), className: "text-xs px-3 py-1 border border-violet-200 rounded-lg text-violet-700 hover:bg-violet-50", children: "\u56FE\u8C31" }), _jsx("button", { type: "button", onClick: () => knowledgeApi.downloadDocument(kb.id, doc.id, doc.name), className: "text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50", children: "\u4E0B\u8F7D" }), _jsx("button", { type: "button", onClick: () => handleDelete(doc), className: "text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50", children: "\u5220\u9664" })] })] }, doc.id))) }))] }));
}
export default function KnowledgePanel({ userId, deepLinkKbId, deepLinkDocId, }) {
    const navigate = useNavigate();
    const [bases, setBases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(deepLinkKbId ?? null);
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [errMsg, setErrMsg] = useState(null);
    useEffect(() => {
        if (deepLinkKbId)
            setSelectedId(deepLinkKbId);
    }, [deepLinkKbId]);
    const load = useCallback(async () => {
        setLoading(true);
        setErrMsg(null);
        try {
            const cfg = await knowledgeApi.getServiceConfig();
            if (cfg.base_url?.trim() && !userId.trim()) {
                setBases([]);
                setErrMsg("请先在「历史」页设置用户 ID");
                return;
            }
            await ensureKnowledgeKey(cfg, userId);
            const res = await knowledgeApi.listBases(1, 100);
            let items = res.items;
            if (deepLinkKbId && !items.some((kb) => kb.id === deepLinkKbId)) {
                try {
                    const kb = await knowledgeApi.getBase(deepLinkKbId);
                    items = [...items, kb];
                }
                catch {
                    setErrMsg("知识库不存在或无法访问");
                }
            }
            setBases(items);
        }
        catch (e) {
            setBases([]);
            setErrMsg(e instanceof Error ? e.message : "加载知识库失败");
        }
        finally {
            setLoading(false);
        }
    }, [userId, deepLinkKbId]);
    useEffect(() => { void load(); }, [load]);
    const handleServiceConfigSaved = useCallback(async (saved) => {
        setSelectedId(null);
        setEditingId(null);
        setLoading(true);
        setErrMsg(null);
        try {
            await ensureKnowledgeKey(saved, userId, true);
            const res = await knowledgeApi.listBases(1, 100);
            setBases(res.items);
        }
        catch (e) {
            setBases([]);
            setErrMsg(e instanceof Error ? e.message : "刷新知识库失败");
        }
        finally {
            setLoading(false);
        }
    }, [userId]);
    const selected = bases.find((b) => b.id === selectedId) ?? null;
    const handleCreate = async (name, description) => {
        setErrMsg(null);
        try {
            const kb = await knowledgeApi.createBase({ name, description, type: "document" });
            setShowCreate(false);
            setSelectedId(kb.id);
            load();
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "创建失败");
        }
    };
    const handleUpdate = async (kbId, name, description) => {
        setErrMsg(null);
        try {
            await knowledgeApi.updateBase(kbId, { name, description });
            setEditingId(null);
            load();
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "保存失败");
        }
    };
    const handleDelete = async (kb) => {
        if (!confirm(`确认删除知识库「${kb.name}」及其全部文档？`))
            return;
        await knowledgeApi.deleteBase(kb.id);
        if (selectedId === kb.id)
            setSelectedId(null);
        load();
    };
    const openKnowledgeBase = (kbId) => {
        setErrMsg(null);
        setSelectedId(kbId);
    };
    const handleBackToBaseList = () => {
        setSelectedId(null);
        navigate("/admin?tab=knowledge");
        void load();
    };
    if (loading) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsx(KnowledgeServiceSection, { userId: userId, onSaved: handleServiceConfigSaved }), _jsx("div", { className: "text-sm text-ink-400", children: "\u52A0\u8F7D\u77E5\u8BC6\u5E93\u2026" })] }));
    }
    if (selected) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsx(KnowledgeServiceSection, { userId: userId, onSaved: handleServiceConfigSaved }), _jsx("button", { type: "button", onClick: handleBackToBaseList, className: "text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1", children: "\u2190 \u8FD4\u56DE\u77E5\u8BC6\u5E93\u5217\u8868" }), _jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsx("h2", { className: "text-base font-semibold text-ink-900", children: selected.name }), _jsxs("span", { className: "text-xs text-ink-400", children: [selected.document_count, " \u4E2A\u6587\u6863"] })] }), _jsx(DocumentSection, { kb: selected, deepLinkDocId: deepLinkDocId })] }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsx(KnowledgeServiceSection, { userId: userId, onSaved: handleServiceConfigSaved }), errMsg && (_jsx("p", { className: "text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700", children: errMsg })), showCreate ? (_jsx(BaseForm, { submitLabel: "\u521B\u5EFA", onSubmit: handleCreate, onCancel: () => setShowCreate(false) })) : (_jsx("button", { type: "button", onClick: () => setShowCreate(true), className: "w-full py-2.5 border-2 border-dashed border-brand-300/80 text-brand-700 text-sm rounded-xl hover:bg-brand-50/50 transition-colors", children: "+ \u65B0\u5EFA\u77E5\u8BC6\u5E93" })), bases.length === 0 ? (_jsx("p", { className: "text-sm text-ink-400 text-center py-10 border border-dashed border-ink-200 rounded-xl", children: "\u6682\u65E0\u77E5\u8BC6\u5E93" })) : (_jsx("div", { className: "space-y-2", children: bases.map((kb) => (_jsx("div", { className: "border border-ink-200/60 rounded-xl overflow-hidden", children: editingId === kb.id ? (_jsx("div", { className: "p-4", children: _jsx(BaseForm, { initial: { name: kb.name, description: kb.description }, submitLabel: "\u4FDD\u5B58", onSubmit: (name, desc) => handleUpdate(kb.id, name, desc), onCancel: () => setEditingId(null) }) })) : (_jsxs("div", { className: "flex items-center gap-3 px-4 py-3", children: [_jsxs("button", { type: "button", onClick: () => openKnowledgeBase(kb.id), className: "flex-1 min-w-0 text-left", children: [_jsx("p", { className: "text-sm font-medium text-ink-800 truncate", children: kb.name }), _jsxs("p", { className: "text-xs text-ink-400 mt-0.5 truncate", children: [kb.description || "无描述", " \u00B7 ", kb.document_count, " \u4E2A\u6587\u6863"] })] }), _jsxs("div", { className: "flex gap-2 shrink-0", children: [_jsx("button", { type: "button", onClick: () => openKnowledgeBase(kb.id), className: "text-xs px-3 py-1 border border-brand-200 rounded-lg text-brand-700 hover:bg-brand-50", children: "\u6587\u6863" }), _jsx("button", { type: "button", onClick: () => setEditingId(kb.id), className: "text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50", children: "\u7F16\u8F91" }), _jsx("button", { type: "button", onClick: () => handleDelete(kb), className: "text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50", children: "\u5220\u9664" })] })] })) }, kb.id))) }))] }));
}
