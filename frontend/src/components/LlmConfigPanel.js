import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { configApi } from "../api/config";
const EMPTY = { base_url: "", api_key: "", model: "", timeout: 120, protocol: "openai" };
// 常用服务商预设，方便快速填写
const PRESETS = {
    openai: { protocol: "openai", base_url: "https://api.openai.com/v1", model: "gpt-4o" },
    anthropic: { protocol: "anthropic", base_url: "https://api.anthropic.com", model: "claude-opus-4-5-20251101" },
    dashscope: { protocol: "openai", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-max" },
    deepseek: { protocol: "openai", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    groq: { protocol: "openai", base_url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
};
export default function LlmConfigPanel() {
    const [form, setForm] = useState(EMPTY);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState(null);
    const [showKey, setShowKey] = useState(false);
    useEffect(() => {
        configApi.getLlm()
            .then((cfg) => { if (cfg)
            setForm(cfg); })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);
    const handleSave = async () => {
        setSaving(true);
        setMsg(null);
        try {
            await configApi.saveLlm(form);
            setMsg({ type: "ok", text: "保存成功，立即生效（llm-proxy 热更新无需重启）。" });
        }
        catch (e) {
            setMsg({ type: "err", text: e instanceof Error ? e.message : "保存失败" });
        }
        finally {
            setSaving(false);
        }
    };
    if (loading)
        return _jsx("div", { className: "text-sm text-gray-400", children: "\u52A0\u8F7D\u4E2D\u2026" });
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u5FEB\u901F\u9009\u62E9\u670D\u52A1\u5546" }), _jsx("div", { className: "flex gap-2 flex-wrap", children: Object.entries(PRESETS).map(([key, preset]) => (_jsx("button", { onClick: () => setForm((f) => ({ ...f, ...preset })), className: "text-xs px-3 py-1 border border-gray-300 rounded-full hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 transition-colors", children: key }, key))) })] }), _jsx(Field, { label: "\u534F\u8BAE", children: _jsxs("select", { value: form.protocol, onChange: (e) => setForm({ ...form, protocol: e.target.value }), className: inputCls, children: [_jsx("option", { value: "openai", children: "OpenAI-compatible\uFF08OpenAI / \u767E\u70BC / DeepSeek / Groq \u7B49\uFF09" }), _jsx("option", { value: "anthropic", children: "Anthropic Messages API\uFF08Claude \u539F\u751F\u534F\u8BAE\uFF09" })] }) }), _jsx(Field, { label: "Base URL", children: _jsx("input", { type: "url", value: form.base_url, onChange: (e) => setForm({ ...form, base_url: e.target.value }), placeholder: form.protocol === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1", className: inputCls }) }), _jsx(Field, { label: "API Key", children: _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { type: showKey ? "text" : "password", value: form.api_key, onChange: (e) => setForm({ ...form, api_key: e.target.value }), placeholder: form.protocol === "anthropic" ? "sk-ant-..." : "sk-...", className: `${inputCls} flex-1` }), _jsx("button", { onClick: () => setShowKey((v) => !v), className: "text-xs text-gray-500 px-2 border border-gray-300 rounded-lg hover:bg-gray-50", children: showKey ? "隐藏" : "显示" })] }) }), _jsx(Field, { label: "\u6A21\u578B", children: _jsx("input", { value: form.model, onChange: (e) => setForm({ ...form, model: e.target.value }), placeholder: form.protocol === "anthropic" ? "claude-opus-4-5-20251101" : "gpt-4o", className: inputCls }) }), _jsx(Field, { label: "\u8D85\u65F6\uFF08\u79D2\uFF09", children: _jsx("input", { type: "number", value: form.timeout, onChange: (e) => setForm({ ...form, timeout: Number(e.target.value) }), min: 10, max: 600, className: inputCls }) }), msg && (_jsx("p", { className: `text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`, children: msg.text })), _jsx("button", { onClick: handleSave, disabled: saving, className: "px-5 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors", children: saving ? "保存中…" : "保存" })] }));
}
function Field({ label, children, placeholder: _p }) {
    return (_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: label }), children] }));
}
const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";
