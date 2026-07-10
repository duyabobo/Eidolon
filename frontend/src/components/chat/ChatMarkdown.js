import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { isWikiNodeHref, wikiAwareUrlTransform, wikiNodeIdFromHref } from "../knowledge/wikiMarkdownLinks";
import { preprocessChatMarkdown } from "./chatMarkdownPreprocess";
import ChatWikiNodeModal from "./ChatWikiNodeModal";
function buildMarkdownComponents(linkMode, onWikiNodeClick) {
    return {
        a: ({ href, children }) => {
            if (!href)
                return _jsx("span", { children: children });
            if (isWikiNodeHref(href)) {
                if (linkMode === "plain") {
                    return _jsx("span", { className: "text-brand-600 break-all", children: children });
                }
                return (_jsx("button", { type: "button", onClick: () => onWikiNodeClick(wikiNodeIdFromHref(href)), className: "text-brand-600 hover:text-brand-700 hover:underline break-all inline text-left", children: children }));
            }
            return (_jsx("a", { href: href, target: "_blank", rel: "noreferrer", className: "text-brand-600 hover:text-brand-700 hover:underline break-all", children: children }));
        },
        table: ({ children }) => (_jsx("div", { className: "chat-md-table-wrap overflow-x-auto -mx-1 px-1 my-2", children: _jsx("table", { children: children }) })),
    };
}
export default function ChatMarkdown({ content, className = "", streaming = false, linkMode = "modal", }) {
    const [wikiNodeId, setWikiNodeId] = useState(null);
    const components = useMemo(() => buildMarkdownComponents(linkMode, (nodeId) => setWikiNodeId(nodeId)), [linkMode]);
    if (!content && !streaming)
        return null;
    const processed = content ? preprocessChatMarkdown(content) : "";
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: `chat-md prose prose-sm max-w-none text-ink-900 ${className}`.trim(), children: [processed ? (_jsx(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex], components: components, urlTransform: wikiAwareUrlTransform, children: processed })) : null, streaming && (_jsx("span", { className: "inline-block w-0.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle rounded-full" }))] }), wikiNodeId && linkMode === "modal" && (_jsx(ChatWikiNodeModal, { nodeId: wikiNodeId, onClose: () => setWikiNodeId(null) }))] }));
}
