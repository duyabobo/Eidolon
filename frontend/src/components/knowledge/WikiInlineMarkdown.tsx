import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { wikiSanitizeSchema } from "./wikiMarkdownSanitize";

interface WikiInlineMarkdownProps {
  content: string;
  className?: string;
}

/** 行内 Markdown / HTML / LaTeX（元数据标题、引用标签等） */
const inlineComponents: Components = {
  p: ({ children }) => <>{children}</>,
};

export default function WikiInlineMarkdown({ content, className = "" }: WikiInlineMarkdownProps) {
  const text = content.trim();
  if (!text) return null;

  return (
    <span className={`wiki-md wiki-md-inline ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, wikiSanitizeSchema], rehypeKatex]}
        components={inlineComponents}
      >
        {text}
      </ReactMarkdown>
    </span>
  );
}
