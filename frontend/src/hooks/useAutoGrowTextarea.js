import { useCallback, useEffect, useRef } from "react";
const MIN_ROWS = 1;
const MAX_ROWS = 10;
function lineMetrics(el) {
    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize) || 14;
    const rawLine = parseFloat(style.lineHeight);
    const lineHeight = Number.isFinite(rawLine) ? rawLine : fontSize * 1.5;
    const paddingY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    return { lineHeight, paddingY };
}
/**
 * textarea：初始 1 行高，随内容增高，最多 MAX_ROWS 行，超出后内部滚动。
 */
export function useAutoGrowTextarea(value, maxRows = MAX_ROWS) {
    const ref = useRef(null);
    const syncHeight = useCallback(() => {
        const el = ref.current;
        if (!el)
            return;
        const { lineHeight, paddingY } = lineMetrics(el);
        const minPx = lineHeight * MIN_ROWS + paddingY;
        const maxPx = lineHeight * maxRows + paddingY;
        el.style.height = "auto";
        const contentPx = Math.max(el.scrollHeight, minPx);
        if (contentPx > maxPx) {
            el.style.height = `${maxPx}px`;
            el.style.overflowY = "auto";
        }
        else {
            el.style.height = `${contentPx}px`;
            el.style.overflowY = "hidden";
        }
    }, [maxRows]);
    useEffect(() => {
        syncHeight();
    }, [value, syncHeight]);
    return { textareaRef: ref, syncHeight };
}
