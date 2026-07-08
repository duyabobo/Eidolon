import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { knowledgeApi, ensureKnowledgeKey, formatFileSize, docStatusLabel, } from "../api/knowledge";
import DocumentWikiExplorer from "./knowledge/DocumentWikiExplorer";
const EMPTY_SERVICE = { base_url: "", environment: "local", scene_uid: "" };
const ENV_LABELS = { local: "本地", prod: "线上", test: "测试" };
function KnowledgeServiceSection({ onSaved }) {
    const [form, setForm] = useState(EMPTY_SERVICE);
    const [envOptions, setEnvOptions] = useState([]);
    const [history, setHistory] = useState([]);
    const [sceneUidInput, setSceneUidInput] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savingUid, setSavingUid] = useState(false);
    const [msg, setMsg] = useState(null);
    const [showHistory, setShowHistory] = useState(false);
    const loadConfig = useCallback(async () => {
        const [cfg, envs, hist] = await Promise.all([
            knowledgeApi.getServiceConfig(),
            knowledgeApi.listServiceEnvironments(),
            knowledgeApi.listServiceHistory(20),
        ]);
        setForm(cfg);
        setEnvOptions(envs.items);
        setHistory(hist.items);
        setSceneUidInput(cfg.scene_uid ?? "");
    }, []);
    useEffect(() => {
        loadConfig()
            .catch(() => setForm(EMPTY_SERVICE))
            .finally(() => setLoading(false));
    }, [loadConfig]);
    const handleEnvironmentChange = async (environment) => {
        if (!environment || environment === form.environment)
            return;
        setSaving(true);
        setMsg(null);
        try {
            const saved = await knowledgeApi.saveServiceConfig({
                environment,
                base_url: "",
                scene_uid: form.scene_uid ?? "",
            });
            setForm(saved);
            setSceneUidInput(saved.scene_uid ?? "");
            await loadConfig();
            setMsg({ type: "ok", text: `已切换至${ENV_LABELS[environment] ?? environment}，正在重新获取 knowledge_key…` });
            await onSaved(saved);
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "切换失败" });
        }
        finally {
            setSaving(false);
        }
    };
    const handleSaveSceneUid = async () => {
        setSavingUid(true);
        setMsg(null);
        try {
            const saved = await knowledgeApi.saveServiceConfig({
                environment: form.environment ?? "local",
                base_url: form.base_url,
                scene_uid: sceneUidInput.trim(),
            });
            setForm(saved);
            await loadConfig();
            setMsg({ type: "ok", text: "Scene UID 已保存，已重新获取 knowledge_key。" });
            await onSaved(saved);
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "保存失败" });
        }
        finally {
            setSavingUid(false);
        }
    };
    const isRemote = Boolean(form.base_url?.trim());
    const currentEnv = form.environment ?? "local";
    return (_jsxs("div", { className: "border border-ink-200/60 rounded-xl p-4 space-y-3 bg-ink-50/40", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-ink-800", children: "\u77E5\u8BC6\u5E93\u670D\u52A1" }), _jsxs("p", { className: "text-xs text-ink-400 mt-0.5", children: [isRemote ? `远程模式 · ${ENV_LABELS[currentEnv]}` : "本地模式：MongoDB + global/knowledge/", form.created_at && (_jsxs(_Fragment, { children: [" \u00B7 \u5F53\u524D\u914D\u7F6E\u4E8E ", new Date(form.created_at).toLocaleString("zh-CN")] }))] })] }), _jsx("span", { className: `text-[10px] px-2 py-0.5 rounded-full font-medium ${isRemote ? "bg-violet-50 text-violet-700" : "bg-ink-100 text-ink-600"}`, children: isRemote ? "远程" : "本地" })] }), loading ? (_jsx("p", { className: "text-sm text-ink-400", children: "\u52A0\u8F7D\u914D\u7F6E\u2026" })) : (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-ink-600 mb-1", children: "\u670D\u52A1\u73AF\u5883" }), _jsx("select", { value: currentEnv, disabled: saving, onChange: (e) => void handleEnvironmentChange(e.target.value), className: "ui-field w-full", children: (envOptions.length ? envOptions : [
                                    { id: "local", label: "本地", base_url: "" },
                                    { id: "prod", label: "线上", base_url: "" },
                                    { id: "test", label: "测试", base_url: "" },
                                ]).map((opt) => (_jsx("option", { value: opt.id, children: opt.label }, opt.id))) }), isRemote && (_jsx("p", { className: "text-[11px] text-ink-400 mt-1 truncate", children: form.base_url }))] }), _jsxs("div", { children: [_jsx("button", { type: "button", onClick: () => setShowHistory((v) => !v), className: "text-xs text-brand-600 hover:text-brand-700", children: showHistory ? "收起配置历史" : "配置历史（编辑 Scene UID）" }), showHistory && (_jsxs("div", { className: "mt-2 space-y-3 border border-ink-200/60 rounded-lg p-3 bg-white/70", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-ink-600 mb-1", children: "Scene UID" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { value: sceneUidInput, onChange: (e) => setSceneUidInput(e.target.value), placeholder: "\u5982 llm_wiki_pi", className: "ui-field flex-1" }), _jsx("button", { type: "button", disabled: savingUid, onClick: () => void handleSaveSceneUid(), className: "ui-btn-primary text-sm shrink-0", children: savingUid ? "保存中…" : "保存 UID" })] }), _jsx("p", { className: "text-[11px] text-ink-400 mt-1", children: "\u540C\u4E00\u7528\u6237 UID\uFF0C\u5207\u6362\u73AF\u5883\u65F6\u81EA\u52A8\u6CBF\u7528" })] }), history.length > 0 && (_jsx("div", { className: "space-y-1 max-h-40 overflow-y-auto", children: history.map((item) => (_jsxs("div", { className: "text-[11px] text-ink-500 flex gap-2", children: [_jsx("span", { className: "shrink-0", children: new Date(item.created_at).toLocaleString("zh-CN") }), _jsx("span", { children: ENV_LABELS[item.environment] ?? item.environment }), _jsxs("span", { className: "truncate", children: ["uid=", item.scene_uid || "(默认)"] })] }, item.id))) }))] }))] }), msg && (_jsx("p", { className: `text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`, children: msg.text }))] }))] }));
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
function DocumentSection({ kb }) {
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [msg, setMsg] = useState(null);
    const [wikiDoc, setWikiDoc] = useState(null);
    const fileRef = useRef(null);
    const load = useCallback(() => {
        setLoading(true);
        knowledgeApi.listDocuments(kb.id)
            .then((res) => setDocs(res.items))
            .catch(() => setDocs([]))
            .finally(() => setLoading(false));
    }, [kb.id]);
    useEffect(() => { load(); }, [load]);
    const handleUpload = async (files) => {
        if (!files?.length)
            return;
        setUploading(true);
        setMsg(null);
        try {
            for (const file of Array.from(files)) {
                await knowledgeApi.uploadDocument(kb.id, file);
            }
            setMsg({ type: "ok", text: "文档上传成功" });
            load();
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "上传失败" });
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
            setWikiDoc(null);
        load();
    };
    if (wikiDoc) {
        return (_jsx(DocumentWikiExplorer, { kbId: kb.id, doc: wikiDoc, onBack: () => setWikiDoc(null) }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs text-ink-400 mt-0.5", children: kb.description || "暂无描述" }), _jsx("p", { className: "text-[11px] text-ink-400 mt-1", children: "\u652F\u6301 pdf / docx / txt / md / csv / xlsx / pptx\uFF0C\u5355\u6587\u4EF6 \u2264 10MB \u00B7 \u70B9\u51FB\u6587\u6863\u67E5\u770B Wiki \u77E5\u8BC6\u56FE\u8C31" })] }), _jsxs("div", { children: [_jsx("input", { ref: fileRef, type: "file", multiple: true, accept: ".pdf,.docx,.txt,.md,.csv,.xlsx,.pptx", className: "hidden", onChange: (e) => handleUpload(e.target.files) }), _jsx("button", { type: "button", disabled: uploading, onClick: () => fileRef.current?.click(), className: "ui-btn-primary text-sm", children: uploading ? "上传中…" : "上传文档" })] })] }), msg && (_jsx("p", { className: `text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`, children: msg.text })), loading ? (_jsx("p", { className: "text-sm text-ink-400", children: "\u52A0\u8F7D\u6587\u6863\u2026" })) : docs.length === 0 ? (_jsx("p", { className: "text-sm text-ink-400 text-center py-10 border border-dashed border-ink-200 rounded-xl", children: "\u6682\u65E0\u6587\u6863\uFF0C\u70B9\u51FB\u300C\u4E0A\u4F20\u6587\u6863\u300D\u6DFB\u52A0" })) : (_jsx("div", { className: "space-y-2", children: docs.map((doc) => (_jsxs("div", { className: "flex items-center gap-3 border border-ink-200/60 rounded-xl px-4 py-3", children: [_jsxs("button", { type: "button", onClick: () => setWikiDoc(doc), className: "flex-1 min-w-0 text-left hover:opacity-80 transition-opacity", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: "text-sm font-medium text-ink-800 truncate", children: doc.name }), _jsx(StatusBadge, { status: doc.status })] }), _jsxs("p", { className: "text-xs text-ink-400 mt-0.5", children: [formatFileSize(doc.file_size), " \u00B7 ", new Date(doc.created_at).toLocaleString("zh-CN")] })] }), _jsxs("div", { className: "flex gap-2 shrink-0", children: [_jsx("button", { type: "button", onClick: () => setWikiDoc(doc), className: "text-xs px-3 py-1 border border-violet-200 rounded-lg text-violet-700 hover:bg-violet-50", children: "\u56FE\u8C31" }), _jsx("button", { type: "button", onClick: () => knowledgeApi.downloadDocument(kb.id, doc.id, doc.name), className: "text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50", children: "\u4E0B\u8F7D" }), _jsx("button", { type: "button", onClick: () => handleDelete(doc), className: "text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50", children: "\u5220\u9664" })] })] }, doc.id))) }))] }));
}
export default function KnowledgePanel() {
    const [bases, setBases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(null);
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [msg, setMsg] = useState(null);
    const load = useCallback(async () => {
        setLoading(true);
        setMsg(null);
        try {
            const cfg = await knowledgeApi.getServiceConfig();
            await ensureKnowledgeKey(cfg);
            const res = await knowledgeApi.listBases();
            setBases(res.items);
        }
        catch (e) {
            setBases([]);
            setMsg({ type: "err", text: e instanceof Error ? e.message : "加载知识库失败" });
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { void load(); }, [load]);
    const handleServiceConfigSaved = useCallback(async (saved) => {
        setSelectedId(null);
        setEditingId(null);
        setLoading(true);
        setMsg(null);
        try {
            await ensureKnowledgeKey(saved, true);
            const res = await knowledgeApi.listBases();
            setBases(res.items);
        }
        catch (e) {
            setBases([]);
            setMsg({ type: "err", text: e instanceof Error ? e.message : "刷新知识库失败" });
        }
        finally {
            setLoading(false);
        }
    }, []);
    const selected = bases.find((b) => b.id === selectedId) ?? null;
    const handleCreate = async (name, description) => {
        setMsg(null);
        try {
            const kb = await knowledgeApi.createBase({ name, description, type: "document" });
            setShowCreate(false);
            setSelectedId(kb.id);
            load();
            setMsg({ type: "ok", text: `知识库「${name}」已创建` });
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "创建失败" });
        }
    };
    const handleUpdate = async (kbId, name, description) => {
        setMsg(null);
        try {
            await knowledgeApi.updateBase(kbId, { name, description });
            setEditingId(null);
            load();
            setMsg({ type: "ok", text: "已保存" });
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "保存失败" });
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
    if (loading) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsx(KnowledgeServiceSection, { onSaved: handleServiceConfigSaved }), _jsx("div", { className: "text-sm text-ink-400", children: "\u52A0\u8F7D\u77E5\u8BC6\u5E93\u2026" })] }));
    }
    if (selected) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsx(KnowledgeServiceSection, { onSaved: handleServiceConfigSaved }), _jsx("button", { type: "button", onClick: () => setSelectedId(null), className: "text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1", children: "\u2190 \u8FD4\u56DE\u77E5\u8BC6\u5E93\u5217\u8868" }), _jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsx("h2", { className: "text-base font-semibold text-ink-900", children: selected.name }), _jsxs("span", { className: "text-xs text-ink-400", children: [selected.document_count, " \u4E2A\u6587\u6863"] })] }), msg && (_jsx("p", { className: `text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`, children: msg.text })), _jsx(DocumentSection, { kb: selected })] }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsx(KnowledgeServiceSection, { onSaved: handleServiceConfigSaved }), msg && (_jsx("p", { className: `text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`, children: msg.text })), showCreate ? (_jsx(BaseForm, { submitLabel: "\u521B\u5EFA", onSubmit: handleCreate, onCancel: () => setShowCreate(false) })) : (_jsx("button", { type: "button", onClick: () => setShowCreate(true), className: "w-full py-2.5 border-2 border-dashed border-brand-300/80 text-brand-700 text-sm rounded-xl hover:bg-brand-50/50 transition-colors", children: "+ \u65B0\u5EFA\u77E5\u8BC6\u5E93" })), bases.length === 0 ? (_jsx("p", { className: "text-sm text-ink-400 text-center py-10 border border-dashed border-ink-200 rounded-xl", children: "\u6682\u65E0\u77E5\u8BC6\u5E93" })) : (_jsx("div", { className: "space-y-2", children: bases.map((kb) => (_jsx("div", { className: "border border-ink-200/60 rounded-xl overflow-hidden", children: editingId === kb.id ? (_jsx("div", { className: "p-4", children: _jsx(BaseForm, { initial: { name: kb.name, description: kb.description }, submitLabel: "\u4FDD\u5B58", onSubmit: (name, desc) => handleUpdate(kb.id, name, desc), onCancel: () => setEditingId(null) }) })) : (_jsxs("div", { className: "flex items-center gap-3 px-4 py-3", children: [_jsxs("button", { type: "button", onClick: () => setSelectedId(kb.id), className: "flex-1 min-w-0 text-left", children: [_jsx("p", { className: "text-sm font-medium text-ink-800 truncate", children: kb.name }), _jsxs("p", { className: "text-xs text-ink-400 mt-0.5 truncate", children: [kb.description || "无描述", " \u00B7 ", kb.document_count, " \u4E2A\u6587\u6863"] })] }), _jsxs("div", { className: "flex gap-2 shrink-0", children: [_jsx("button", { type: "button", onClick: () => setSelectedId(kb.id), className: "text-xs px-3 py-1 border border-brand-200 rounded-lg text-brand-700 hover:bg-brand-50", children: "\u6587\u6863" }), _jsx("button", { type: "button", onClick: () => setEditingId(kb.id), className: "text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50", children: "\u7F16\u8F91" }), _jsx("button", { type: "button", onClick: () => handleDelete(kb), className: "text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50", children: "\u5220\u9664" })] })] })) }, kb.id))) }))] }));
}
