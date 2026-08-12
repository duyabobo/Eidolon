import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
/** 行内 Markdown/LaTeX（链接标题、描述等，不包段落块） */
const inlineComponents = {
    p: ({ children }) => _jsx(_Fragment, { children: children }),
};
export default function WikiInlineMarkdown({ content, className = "" }) {
    const text = content.trim();
    if (!text)
        return null;
    return (_jsx("span", { className: `wiki-md wiki-md-inline ${className}`.trim(), children: _jsx(ReactMarkdown, { remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex], components: inlineComponents, children: text }) }));
}
