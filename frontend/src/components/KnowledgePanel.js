import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { knowledgeApi, ensureKnowledgeKey, formatFileSize, docStatusLabel, } from "../api/knowledge";
import { setKnowledgeSceneUid } from "../api/knowledgeKeyCache";
import { formatChinaDateTime } from "../utils/datetime";
import { ConfigActionBtn, ConfigPrimaryBtn, ConfigToolbarBtn } from "./config/ConfigActionBtn";
import { ConfigListItem } from "./config/ConfigListItem";
import { ConfigEmptyState, ConfigListPagination, ConfigListToolbar, ConfigPanelLayout, } from "./config/ConfigPanelLayout";
import DocumentWikiExplorer from "./knowledge/DocumentWikiExplorer";
import { CONFIG_PAGE_SIZE } from "./config/useClientPagination";
const EMPTY_SERVICE = { base_url: "", environment: "local" };
const PAGE_SIZE = CONFIG_PAGE_SIZE;
function StatusBadge({ status }) {
    const cls = {
        uploaded: "bg-sky-50 text-sky-700",
        processing: "bg-amber-50 text-amber-700",
        indexed: "bg-emerald-50 text-emerald-700",
        failed: "bg-rose-50 text-rose-700",
    }[status];
    return (_jsx("span", { className: `text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cls}`, children: docStatusLabel(status) }));
}
function BaseModal({ title, initial, onSubmit, onCancel, submitLabel, }) {
    const [name, setName] = useState(initial?.name ?? "");
    const [description, setDescription] = useState(initial?.description ?? "");
    return (_jsx("div", { className: "fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60", children: [_jsx("div", { className: "px-6 py-4 border-b border-ink-200/60", children: _jsx("h2", { className: "font-semibold text-ink-900", children: title }) }), _jsxs("div", { className: "px-6 py-4 space-y-3", children: [_jsx("input", { value: name, onChange: (e) => setName(e.target.value), placeholder: "\u77E5\u8BC6\u5E93\u540D\u79F0", className: "ui-field w-full", autoFocus: true }), _jsx("textarea", { value: description, onChange: (e) => setDescription(e.target.value), placeholder: "\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09", rows: 2, className: "ui-field w-full resize-none" })] }), _jsxs("div", { className: "px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2", children: [_jsx("button", { type: "button", onClick: onCancel, className: "px-4 py-2 text-sm border border-ink-200 rounded-xl", children: "\u53D6\u6D88" }), _jsx("button", { type: "button", disabled: !name.trim(), onClick: () => onSubmit(name.trim(), description.trim()), className: "ui-btn-primary", children: submitLabel })] })] }) }));
}
const DOC_POLL_INTERVAL_MS = 10000;
const TERMINAL_DOC_STATUSES = ["indexed", "failed"];
function isPendingDocument(status) {
    return !TERMINAL_DOC_STATUSES.includes(status);
}
function DocumentSection({ kb, deepLinkDocId, onBack, }) {
    const navigate = useNavigate();
    const [docs, setDocs] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [errMsg, setErrMsg] = useState(null);
    const [wikiDoc, setWikiDoc] = useState(null);
    const [wikiLoading, setWikiLoading] = useState(false);
    const fileRef = useRef(null);
    const openWiki = useCallback((doc) => {
        setWikiDoc(doc);
        navigate(`/knowledge/bases/${encodeURIComponent(kb.id)}/documents/${encodeURIComponent(doc.id)}`);
    }, [kb.id, navigate]);
    const closeWiki = useCallback(() => {
        setWikiDoc(null);
        navigate(`/knowledge/bases/${encodeURIComponent(kb.id)}`);
    }, [kb.id, navigate]);
    const load = useCallback((silent = false, targetPage = page) => {
        if (!silent)
            setLoading(true);
        return knowledgeApi.listDocuments(kb.id, targetPage, PAGE_SIZE)
            .then((res) => {
            setDocs(res.items);
            setTotal(res.total);
        })
            .catch(() => {
            if (!silent) {
                setDocs([]);
                setTotal(0);
            }
        })
            .finally(() => {
            if (!silent)
                setLoading(false);
        });
    }, [kb.id, page]);
    useEffect(() => { void load(false, page); }, [load, page]);
    const hasPendingDocs = docs.some((doc) => isPendingDocument(doc.status));
    useEffect(() => {
        if (!hasPendingDocs)
            return;
        const timer = setInterval(() => void load(true, page), DOC_POLL_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [hasPendingDocs, load, page]);
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
            setPage(1);
            await load(false, 1);
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
        void load(false, page);
    };
    if (wikiLoading) {
        return _jsx("p", { className: "text-sm text-ink-400 py-6", children: "\u52A0\u8F7D\u6587\u6863\u2026" });
    }
    if (wikiDoc) {
        return (_jsx(DocumentWikiExplorer, { kbId: kb.id, doc: wikiDoc, onBack: closeWiki }));
    }
    return (_jsxs(ConfigPanelLayout, { loading: loading, loadingText: "\u52A0\u8F7D\u6587\u6863\u2026", errMsg: errMsg, toolbar: (_jsx(ConfigListToolbar, { left: (_jsxs(_Fragment, { children: [_jsx(ConfigToolbarBtn, { onClick: onBack, children: "\u2190 \u8FD4\u56DE\u5217\u8868" }), _jsx("span", { className: "text-sm font-medium text-ink-800 truncate", children: kb.name }), _jsxs("span", { className: "text-xs text-ink-400", children: [total, " \u4E2A\u6587\u6863"] })] })), right: (_jsxs(_Fragment, { children: [_jsx("input", { ref: fileRef, type: "file", multiple: true, accept: ".pdf,.docx,.txt,.md,.csv,.xlsx,.pptx", className: "hidden", onChange: (e) => void handleUpload(e.target.files) }), _jsx(ConfigPrimaryBtn, { disabled: uploading, onClick: () => fileRef.current?.click(), children: uploading ? "添加中…" : "添加" })] })) })), pagination: (_jsx(ConfigListPagination, { page: page, pageSize: PAGE_SIZE, total: total, onPageChange: setPage })), children: [_jsx("p", { className: "text-xs text-ink-400 -mt-2", children: "\u652F\u6301 pdf / docx / txt / md / csv / xlsx / pptx\uFF0C\u5355\u6587\u4EF6 \u2264 10MB" }), docs.length === 0 ? (_jsx(ConfigEmptyState, { message: "\u6682\u65E0\u6587\u6863\uFF0C\u70B9\u51FB\u300C\u6DFB\u52A0\u300D\u4E0A\u4F20" })) : (_jsx("div", { className: "space-y-2", children: docs.map((doc) => (_jsx(ConfigListItem, { title: doc.name, meta: _jsx(StatusBadge, { status: doc.status }), subtitle: `${formatFileSize(doc.file_size)} · ${formatChinaDateTime(doc.created_at, {
                        year: "numeric", month: "2-digit", day: "2-digit",
                        hour: "2-digit", minute: "2-digit", hour12: false,
                    })}`, actions: (_jsxs(_Fragment, { children: [_jsx(ConfigActionBtn, { variant: "violet", onClick: () => openWiki(doc), children: "\u56FE\u8C31" }), _jsx(ConfigActionBtn, { onClick: () => knowledgeApi.downloadDocument(kb.id, doc.id, doc.name), children: "\u4E0B\u8F7D" }), _jsx(ConfigActionBtn, { variant: "danger", onClick: () => void handleDelete(doc), children: "\u5220\u9664" })] })) }, doc.id))) }))] }));
}
export default function KnowledgePanel({ userId, deepLinkKbId, deepLinkDocId, }) {
    const navigate = useNavigate();
    const [bases, setBases] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(deepLinkKbId ?? null);
    const [baseModal, setBaseModal] = useState(null);
    const [errMsg, setErrMsg] = useState(null);
    const [selectedKb, setSelectedKb] = useState(null);
    const [selectedKbLoading, setSelectedKbLoading] = useState(false);
    const [serviceForm, setServiceForm] = useState(EMPTY_SERVICE);
    const [envOptions, setEnvOptions] = useState([]);
    const [envLoading, setEnvLoading] = useState(true);
    const [envSaving, setEnvSaving] = useState(false);
    useEffect(() => {
        if (deepLinkKbId)
            setSelectedId(deepLinkKbId);
    }, [deepLinkKbId]);
    const loadServiceConfig = useCallback(async () => {
        setEnvLoading(true);
        try {
            const [cfg, envs] = await Promise.all([
                knowledgeApi.getServiceConfig(),
                knowledgeApi.listServiceEnvironments(),
            ]);
            setServiceForm(cfg);
            setEnvOptions(envs.items);
            setKnowledgeSceneUid(userId.trim());
        }
        catch {
            setServiceForm(EMPTY_SERVICE);
        }
        finally {
            setEnvLoading(false);
        }
    }, [userId]);
    useEffect(() => { void loadServiceConfig(); }, [loadServiceConfig]);
    const loadBases = useCallback(async (targetPage = page) => {
        setLoading(true);
        setErrMsg(null);
        try {
            const cfg = await knowledgeApi.getServiceConfig();
            if (cfg.base_url?.trim() && !userId.trim()) {
                setBases([]);
                setTotal(0);
                setErrMsg("请先在右上角「历史」中设置用户 ID");
                return;
            }
            await ensureKnowledgeKey(cfg, userId);
            const res = await knowledgeApi.listBases(targetPage, PAGE_SIZE);
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
            setTotal(res.total);
        }
        catch (e) {
            setBases([]);
            setTotal(0);
            setErrMsg(e instanceof Error ? e.message : "加载知识库失败");
        }
        finally {
            setLoading(false);
        }
    }, [userId, deepLinkKbId, page]);
    useEffect(() => { void loadBases(page); }, [loadBases, page]);
    useEffect(() => {
        if (!selectedId) {
            setSelectedKb(null);
            return;
        }
        const fromList = bases.find((b) => b.id === selectedId);
        if (fromList) {
            setSelectedKb(fromList);
            return;
        }
        setSelectedKbLoading(true);
        knowledgeApi.getBase(selectedId)
            .then(setSelectedKb)
            .catch(() => {
            setSelectedKb(null);
            setErrMsg("知识库不存在或无法访问");
            setSelectedId(null);
            navigate("/knowledge");
        })
            .finally(() => setSelectedKbLoading(false));
    }, [selectedId, bases, navigate]);
    const handleEnvironmentChange = async (environment) => {
        if (!environment || environment === serviceForm.environment)
            return;
        const targetOpt = (envOptions.length ? envOptions : []).find((opt) => opt.id === environment);
        if (targetOpt?.base_url?.trim() && !userId.trim()) {
            setErrMsg("请先在右上角「历史」中设置用户 ID");
            return;
        }
        setEnvSaving(true);
        setErrMsg(null);
        try {
            const saved = await knowledgeApi.saveServiceConfig({ environment, base_url: "" });
            setServiceForm(saved);
            setSelectedId(null);
            setPage(1);
            await ensureKnowledgeKey(saved, userId, true);
            await loadBases(1);
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "切换失败");
        }
        finally {
            setEnvSaving(false);
        }
    };
    const selected = selectedKb;
    const handleCreate = async (name, description) => {
        setErrMsg(null);
        try {
            const kb = await knowledgeApi.createBase({ name, description, type: "document" });
            setBaseModal(null);
            setSelectedId(kb.id);
            navigate(`/knowledge/bases/${encodeURIComponent(kb.id)}`);
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "创建失败");
        }
    };
    const handleUpdate = async (kbId, name, description) => {
        setErrMsg(null);
        try {
            await knowledgeApi.updateBase(kbId, { name, description });
            setBaseModal(null);
            void loadBases(page);
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
        void loadBases(page);
    };
    const openKnowledgeBase = (kbId) => {
        setErrMsg(null);
        setSelectedId(kbId);
        navigate(`/knowledge/bases/${encodeURIComponent(kbId)}`);
    };
    const handleBackToBaseList = () => {
        setSelectedId(null);
        navigate("/knowledge");
        void loadBases(page);
    };
    const envSelect = (_jsx("select", { value: serviceForm.environment ?? "local", disabled: envLoading || envSaving, onChange: (e) => void handleEnvironmentChange(e.target.value), className: "ui-field text-sm py-1.5 min-w-[120px]", children: (envOptions.length ? envOptions : [
            { id: "local", label: "本地", base_url: "" },
            { id: "prod", label: "线上", base_url: "" },
            { id: "test", label: "测试", base_url: "" },
        ]).map((opt) => (_jsx("option", { value: opt.id, children: opt.label }, opt.id))) }));
    if (selectedId && selectedKbLoading) {
        return _jsx("p", { className: "text-sm text-ink-400 py-6", children: "\u52A0\u8F7D\u77E5\u8BC6\u5E93\u2026" });
    }
    if (selected) {
        return (_jsx(DocumentSection, { kb: selected, deepLinkDocId: deepLinkDocId, onBack: handleBackToBaseList }));
    }
    return (_jsxs(ConfigPanelLayout, { loading: loading || envLoading, loadingText: "\u52A0\u8F7D\u77E5\u8BC6\u5E93\u2026", errMsg: errMsg, toolbar: (_jsx(ConfigListToolbar, { left: envSelect, right: _jsx(ConfigPrimaryBtn, { onClick: () => setBaseModal({ mode: "create" }), children: "\u6DFB\u52A0" }) })), pagination: (_jsx(ConfigListPagination, { page: page, pageSize: PAGE_SIZE, total: total, onPageChange: setPage })), children: [bases.length === 0 ? (_jsx(ConfigEmptyState, { message: "\u6682\u65E0\u77E5\u8BC6\u5E93" })) : (_jsx("div", { className: "space-y-2", children: bases.map((kb) => (_jsx(ConfigListItem, { title: kb.name, subtitle: `${kb.description || "无描述"} · ${kb.document_count} 个文档`, actions: (_jsxs(_Fragment, { children: [_jsx(ConfigActionBtn, { variant: "brand", onClick: () => openKnowledgeBase(kb.id), children: "\u6587\u6863" }), _jsx(ConfigActionBtn, { onClick: () => setBaseModal({ mode: "edit", kb }), children: "\u7F16\u8F91" }), _jsx(ConfigActionBtn, { variant: "danger", onClick: () => void handleDelete(kb), children: "\u5220\u9664" })] })) }, kb.id))) })), baseModal?.mode === "create" && (_jsx(BaseModal, { title: "\u65B0\u5EFA\u77E5\u8BC6\u5E93", submitLabel: "\u521B\u5EFA", onSubmit: handleCreate, onCancel: () => setBaseModal(null) })), baseModal?.mode === "edit" && (_jsx(BaseModal, { title: `编辑 · ${baseModal.kb.name}`, initial: { name: baseModal.kb.name, description: baseModal.kb.description }, submitLabel: "\u4FDD\u5B58", onSubmit: (name, desc) => void handleUpdate(baseModal.kb.id, name, desc), onCancel: () => setBaseModal(null) }))] }));
}
