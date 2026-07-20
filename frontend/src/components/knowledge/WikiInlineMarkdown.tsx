import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

interface WikiInlineMarkdownProps {
  content: string;
  className?: string;
}

/** 行内 Markdown/LaTeX（链接标题、描述等，不包段落块） */
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
        rehypePlugins={[rehypeKatex]}
        components={inlineComponents}
      >
        {text}
      </ReactMarkdown>
    </span>
  );
}
