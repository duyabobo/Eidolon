import { jsx as _jsx } from "react/jsx-runtime";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { isolateHtmlTables } from "./wikiHtmlTables";
import { buildTitleNodeIndex, isWikiNodeHref, preprocessConnectionLines, preprocessWikiMarkdown, wikiAwareUrlTransform, wikiNodeIdFromHref, } from "./wikiMarkdownLinks";
import { wikiSanitizeSchema } from "./wikiMarkdownSanitize";
import { preprocessStructuredFields } from "./wikiStructuredText";
export default function WikiMarkdown({ content, className = "", graphNodes = [], onWikiNodeClick, }) {
    const text = content.trim();
    if (!text)
        return null;
    const titleIndex = buildTitleNodeIndex(graphNodes);
    const withStructured = preprocessStructuredFields(text);
    const withTables = isolateHtmlTables(withStructured);
    const withConnections = preprocessConnectionLines(withTables, graphNodes);
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
            return (_jsx("a", { href: href, target: "_blank", rel: "noreferrer", className: "text-brand-600 hover:text-brand-700 hover:underline break-all", children: children }));
        },
        table: ({ children }) => (_jsx("div", { className: "wiki-md-table-wrap my-3", role: "region", "aria-label": "\u6570\u636E\u8868\u683C\uFF0C\u53EF\u6A2A\u5411\u6EDA\u52A8", tabIndex: 0, children: _jsx("table", { children: children }) })),
    };
    return (_jsx("div", { className: `wiki-md prose prose-sm max-w-none text-ink-800 ${className}`.trim(), children: _jsx(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeRaw, [rehypeSanitize, wikiSanitizeSchema], rehypeKatex], components: components, urlTransform: wikiAwareUrlTransform, children: processed }) }));
}
