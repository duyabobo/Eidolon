import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
function pickMetaString(metadata, keys) {
    for (const key of keys) {
        const value = metadata[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return "";
}
export function resolveNodeTitle(node) {
    const fromMeta = node.metadata
        ? pickMetaString(node.metadata, ["title", "name", "名称"])
        : "";
    return fromMeta || node.title.trim();
}
export function resolveNodeType(node) {
    const fromMeta = node.metadata
        ? pickMetaString(node.metadata, ["type", "类型"])
        : "";
    return fromMeta || node.type.trim();
}
function MetaRow({ label, value }) {
    return (_jsxs(_Fragment, { children: [_jsx("dt", { className: "text-ink-500 shrink-0", children: label }), _jsx("dd", { className: "text-ink-900 break-words", children: value || "—" })] }));
}
export default function WikiNodeMeta({ node }) {
    const title = resolveNodeTitle(node);
    const type = resolveNodeType(node);
    return (_jsxs("section", { children: [_jsx("h4", { className: "text-xs font-medium text-ink-500 mb-1.5", children: "\u5143\u6570\u636E" }), _jsxs("dl", { className: "grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-sm leading-relaxed", children: [_jsx(MetaRow, { label: "\u540D\u79F0", value: title }), _jsx(MetaRow, { label: "\u7C7B\u578B", value: type })] })] }));
}
export function isMetadataBodySection(key) {
    const lower = key.toLowerCase();
    return lower === "metadata" || key === "元数据";
}
