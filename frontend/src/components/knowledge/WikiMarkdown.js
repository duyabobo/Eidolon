import { jsx as _jsx } from "react/jsx-runtime";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { buildTitleNodeIndex, isWikiNodeHref, preprocessConnectionLines, preprocessWikiMarkdown, wikiNodeIdFromHref, } from "./wikiMarkdownLinks";
export default function WikiMarkdown({ content, className = "", graphNodes = [], onWikiNodeClick, }) {
    const text = content.trim();
    if (!text)
        return null;
    const titleIndex = buildTitleNodeIndex(graphNodes);
    const withConnections = preprocessConnectionLines(text, graphNodes);
    const processed = preprocessWikiMarkdown(withConnections, titleIndex);
    const components = {
        a: ({ href, children }) => {
            if (href && isWikiNodeHref(href) && onWikiNodeClick) {
                const nodeId = wikiNodeIdFromHref(href);
                return (_jsx("button", { type: "button", onClick: () => onWikiNodeClick(nodeId), className: "text-brand-600 hover:text-brand-700 hover:underline font-medium inline align-baseline", children: children }));
            }
            if (!href) {
                return _jsx("span", { children: children });
            }
            return (_jsx("a", { href: href, target: "_blank", rel: "noreferrer", className: "text-brand-600 hover:underline", children: children }));
        },
    };
    return (_jsx("div", { className: `wiki-md prose prose-sm max-w-none text-ink-800 ${className}`.trim(), children: _jsx(ReactMarkdown, { remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex], components: components, children: processed }) }));
}
