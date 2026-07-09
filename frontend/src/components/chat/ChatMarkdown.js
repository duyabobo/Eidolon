import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
const markdownComponents = {
    a: ({ href, children }) => {
        if (!href)
            return _jsx("span", { children: children });
        return (_jsx("a", { href: href, target: "_blank", rel: "noreferrer", className: "text-brand-600 hover:text-brand-700 hover:underline break-all", children: children }));
    },
};
export default function ChatMarkdown({ content, className = "", streaming = false, }) {
    if (!content && !streaming)
        return null;
    return (_jsxs("div", { className: `chat-md prose prose-sm max-w-none text-ink-900 ${className}`.trim(), children: [content ? (_jsx(ReactMarkdown, { remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex], components: markdownComponents, children: content })) : null, streaming && (_jsx("span", { className: "inline-block w-0.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle rounded-full" }))] }));
}
