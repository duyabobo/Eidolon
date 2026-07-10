import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { isWikiNodeHref, wikiAwareUrlTransform, wikiNodeIdFromHref } from "../knowledge/wikiMarkdownLinks";
import { citeRefNumberFromHref, isCiteRefHref, parseChatCitations, } from "./chatCitationParse";
import { preprocessChatMarkdown } from "./chatMarkdownPreprocess";
import ChatWikiNodeModal from "./ChatWikiNodeModal";
const EXTERNAL_LINK_PATTERN = /^https?:\/\//i;
function buildMarkdownComponents(linkMode, refs, onCitationClick) {
    return {
        a: ({ href, children }) => {
            if (!href)
                return _jsx("span", { children: children });
            if (isCiteRefHref(href)) {
                const num = citeRefNumberFromHref(href);
                const ref = refs.get(num);
                if (!ref || linkMode === "plain") {
                    return _jsx("sup", { className: "text-[10px] text-brand-600 font-semibold", children: num });
                }
                return (_jsx("button", { type: "button", onClick: () => onCitationClick(ref.href), className: "inline p-0 border-0 bg-transparent cursor-pointer align-baseline text-brand-600 hover:text-brand-700", "aria-label": `参考来源 ${num}：${ref.label}`, children: _jsx("sup", { className: "text-[10px] font-semibold", children: num }) }));
            }
            if (isWikiNodeHref(href)) {
                if (linkMode === "plain") {
                    return _jsx("span", { className: "text-brand-600 break-all", children: children });
                }
                return (_jsx("button", { type: "button", onClick: () => onCitationClick(href), className: "text-brand-600 hover:text-brand-700 hover:underline break-all inline text-left", children: children }));
            }
            if (EXTERNAL_LINK_PATTERN.test(href) && linkMode === "modal") {
                return (_jsx("button", { type: "button", onClick: () => onCitationClick(href), className: "text-brand-600 hover:text-brand-700 hover:underline break-all inline text-left", children: children }));
            }
            return (_jsx("a", { href: href, target: "_blank", rel: "noreferrer", className: "text-brand-600 hover:text-brand-700 hover:underline break-all", children: children }));
        },
        table: ({ children }) => (_jsx("div", { className: "chat-md-table-wrap overflow-x-auto -mx-1 px-1 my-2", children: _jsx("table", { children: children }) })),
    };
}
export default function ChatMarkdown({ content, className = "", streaming = false, linkMode = "modal", }) {
    const [wikiNodeId, setWikiNodeId] = useState(null);
    const { markdown, refs } = useMemo(() => {
        if (!content)
            return { markdown: "", refs: new Map() };
        const base = preprocessChatMarkdown(content);
        return parseChatCitations(base);
    }, [content]);
    const handleCitationClick = useCallback((href) => {
        if (isWikiNodeHref(href)) {
            setWikiNodeId(wikiNodeIdFromHref(href));
            return;
        }
        if (EXTERNAL_LINK_PATTERN.test(href)) {
            window.open(href, "_blank", "noopener,noreferrer");
        }
    }, []);
    const components = useMemo(() => buildMarkdownComponents(linkMode, refs, handleCitationClick), [linkMode, refs, handleCitationClick]);
    if (!content && !streaming)
        return null;
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: `chat-md prose prose-sm max-w-none text-ink-900 ${className}`.trim(), children: [markdown ? (_jsx(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex], components: components, urlTransform: wikiAwareUrlTransform, children: markdown })) : null, streaming && (_jsx("span", { className: "inline-block w-0.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle rounded-full" }))] }), wikiNodeId && linkMode === "modal" && (_jsx(ChatWikiNodeModal, { nodeId: wikiNodeId, onClose: () => setWikiNodeId(null) }))] }));
}
