import { jsx as _jsx } from "react/jsx-runtime";
const VARIANT_CLS = {
    default: "border-ink-200 text-ink-600 hover:bg-ink-50",
    primary: "border-brand-200 text-brand-700 hover:bg-brand-50",
    sky: "border-sky-200 text-sky-700 hover:bg-sky-50",
    brand: "border-brand-200 text-brand-700 hover:bg-brand-50",
    violet: "border-violet-200 text-violet-700 hover:bg-violet-50",
    danger: "border-rose-200 text-rose-600 hover:bg-rose-50",
};
export function ConfigActionBtn({ variant = "default", className = "", children, ...rest }) {
    return (_jsx("button", { type: "button", className: `text-xs px-3 py-1 border rounded-lg disabled:opacity-50 ${VARIANT_CLS[variant]} ${className}`, ...rest, children: children }));
}
export function ConfigToolbarBtn({ className = "", children, ...rest }) {
    return (_jsx("button", { type: "button", className: `text-sm px-3 py-1.5 border border-ink-200 rounded-lg text-ink-700 hover:bg-ink-50 disabled:opacity-50 ${className}`, ...rest, children: children }));
}
export function ConfigPrimaryBtn({ className = "", children, ...rest }) {
    return (_jsx("button", { type: "button", className: `ui-btn-primary text-sm ${className}`, ...rest, children: children }));
}
