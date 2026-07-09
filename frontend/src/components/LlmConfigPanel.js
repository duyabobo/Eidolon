import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { configApi } from "../api/config";
import { ConfigActionBtn, ConfigPrimaryBtn } from "./config/ConfigActionBtn";
import { ConfigListItem } from "./config/ConfigListItem";
import { ConfigEmptyState, ConfigListPagination, ConfigListToolbar, ConfigPanelLayout, } from "./config/ConfigPanelLayout";
import { CONFIG_PAGE_SIZE, useClientPagination } from "./config/useClientPagination";
const EMPTY_FORM = {
    name: "",
    base_url: "",
    api_key: "",
    model: "",
    timeout: 120,
    protocol: "openai",
};
const PRESETS = {
    openai: { protocol: "openai", base_url: "https://api.openai.com/v1", model: "gpt-4o" },
    anthropic: { protocol: "anthropic", base_url: "https://api.anthropic.com", model: "claude-opus-4-5-20251101" },
    dashscope: { protocol: "openai", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-max" },
    deepseek: { protocol: "openai", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
};
export default function LlmConfigPanel() {
    const [profiles, setProfiles] = useState([]);
    const [activeId, setActiveId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [errMsg, setErrMsg] = useState(null);
    const [modal, setModal] = useState(null);
    const [saving, setSaving] = useState(false);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await configApi.listLlmProfiles();
            setProfiles(res.items);
            setActiveId(res.active_id);
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "加载失败");
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { void load(); }, [load]);
    const handleSelect = async (id) => {
        if (id === activeId)
            return;
        setErrMsg(null);
        try {
            await configApi.activateLlmProfile(id);
            setActiveId(id);
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "切换失败");
        }
    };
    const openCreate = () => {
        setModal({ mode: "create", form: { ...EMPTY_FORM, name: `配置 ${profiles.length + 1}` } });
    };
    const openEdit = (profile) => {
        setModal({
            mode: "edit",
            profile,
            form: {
                name: profile.name,
                base_url: profile.base_url,
                api_key: profile.api_key,
                model: profile.model,
                timeout: profile.timeout,
                protocol: profile.protocol,
            },
        });
    };
    const handleModalSave = async () => {
        if (!modal)
            return;
        setSaving(true);
        setErrMsg(null);
        try {
            if (modal.mode === "create") {
                const created = await configApi.createLlmProfile(modal.form);
                await configApi.activateLlmProfile(created.id);
            }
            else {
                await configApi.updateLlmProfile(modal.profile.id, modal.form);
            }
            setModal(null);
            await load();
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "保存失败");
        }
        finally {
            setSaving(false);
        }
    };
    const handleDelete = async (profile) => {
        if (!confirm(`确认删除 LLM 配置「${profile.name}」？`))
            return;
        setErrMsg(null);
        try {
            await configApi.deleteLlmProfile(profile.id);
            await load();
        }
        catch (e) {
            setErrMsg(e instanceof Error ? e.message : "删除失败");
        }
    };
    const pagination = useClientPagination(profiles, CONFIG_PAGE_SIZE);
    return (_jsxs(ConfigPanelLayout, { loading: loading, loadingText: "\u52A0\u8F7D LLM \u914D\u7F6E\u2026", errMsg: errMsg, toolbar: (_jsx(ConfigListToolbar, { left: _jsx("p", { className: "text-xs text-ink-500", children: "\u9009\u62E9\u5F53\u524D\u751F\u6548\u7684 LLM \u914D\u7F6E\uFF08\u5355\u9009\uFF09" }), right: _jsx(ConfigPrimaryBtn, { onClick: openCreate, children: "\u6DFB\u52A0" }) })), pagination: (_jsx(ConfigListPagination, { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total, onPageChange: pagination.setPage })), children: [profiles.length === 0 ? (_jsx(ConfigEmptyState, { message: "\u6682\u65E0 LLM \u914D\u7F6E\uFF0C\u70B9\u51FB\u300C\u6DFB\u52A0\u300D\u521B\u5EFA" })) : (_jsx("div", { className: "space-y-2", children: pagination.slice.map((profile) => (_jsx(ConfigListItem, { leading: (_jsx("input", { type: "radio", name: "llm-profile", checked: activeId === profile.id, onChange: () => void handleSelect(profile.id), className: "accent-brand-600 mt-1" })), title: profile.name, meta: activeId === profile.id ? (_jsx("span", { className: "text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-brand-50 text-brand-700", children: "\u5F53\u524D\u751F\u6548" })) : undefined, subtitle: `${profile.protocol} · ${profile.model} · ${profile.base_url}`, actions: (_jsxs(_Fragment, { children: [_jsx(ConfigActionBtn, { onClick: () => openEdit(profile), children: "\u7F16\u8F91" }), _jsx(ConfigActionBtn, { variant: "danger", disabled: profiles.length <= 1, onClick: () => void handleDelete(profile), children: "\u5220\u9664" })] })) }, profile.id))) })), modal && (_jsx(LlmProfileModal, { modal: modal, saving: saving, onChange: (form) => setModal({ ...modal, form }), onSave: () => void handleModalSave(), onCancel: () => setModal(null) }))] }));
}
function LlmProfileModal({ modal, saving, onChange, onSave, onCancel, }) {
    const form = modal.form;
    const [showKey, setShowKey] = useState(false);
    const set = (patch) => onChange({ ...form, ...patch });
    return (_jsx("div", { className: "fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4", children: _jsxs("div", { className: "bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60 max-h-[90vh] overflow-y-auto", children: [_jsx("div", { className: "px-6 py-4 border-b border-ink-200/60", children: _jsx("h2", { className: "font-semibold text-ink-900", children: modal.mode === "create" ? "添加 LLM 配置" : `编辑 · ${modal.profile.name}` }) }), _jsxs("div", { className: "px-6 py-4 space-y-3", children: [_jsx("div", { className: "flex gap-2 flex-wrap", children: Object.entries(PRESETS).map(([key, preset]) => (_jsx("button", { type: "button", onClick: () => onChange({ ...form, ...preset }), className: "text-xs px-3 py-1 border border-ink-200 rounded-full hover:bg-brand-50", children: key }, key))) }), _jsx("input", { value: form.name, onChange: (e) => set({ name: e.target.value }), placeholder: "\u914D\u7F6E\u540D\u79F0", className: "ui-field w-full" }), _jsxs("select", { value: form.protocol, onChange: (e) => set({ protocol: e.target.value }), className: "ui-field w-full", children: [_jsx("option", { value: "openai", children: "OpenAI-compatible" }), _jsx("option", { value: "anthropic", children: "Anthropic Messages API" })] }), _jsx("input", { type: "url", value: form.base_url, onChange: (e) => set({ base_url: e.target.value }), placeholder: "Base URL", className: "ui-field w-full" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { type: showKey ? "text" : "password", value: form.api_key, onChange: (e) => set({ api_key: e.target.value }), placeholder: "API Key", className: "ui-field flex-1" }), _jsx("button", { type: "button", onClick: () => setShowKey((v) => !v), className: "text-xs px-2 border border-ink-200 rounded-lg", children: showKey ? "隐藏" : "显示" })] }), _jsx("input", { value: form.model, onChange: (e) => set({ model: e.target.value }), placeholder: "\u6A21\u578B", className: "ui-field w-full" }), _jsx("input", { type: "number", value: form.timeout, onChange: (e) => set({ timeout: Number(e.target.value) }), min: 10, max: 600, placeholder: "\u8D85\u65F6\uFF08\u79D2\uFF09", className: "ui-field w-full" })] }), _jsxs("div", { className: "px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2", children: [_jsx("button", { type: "button", onClick: onCancel, className: "px-4 py-2 text-sm border border-ink-200 rounded-xl", children: "\u53D6\u6D88" }), _jsx("button", { type: "button", disabled: saving || !form.name.trim() || !form.base_url.trim() || !form.model.trim(), onClick: onSave, className: "ui-btn-primary", children: saving ? "保存中…" : "保存" })] })] }) }));
}
