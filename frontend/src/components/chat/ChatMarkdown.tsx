import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

interface ChatMarkdownProps {
  content: string;
  className?: string;
  streaming?: boolean;
}

const markdownComponents: Components = {
  a: ({ href, children }) => {
    if (!href) return <span>{children}</span>;
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-brand-600 hover:text-brand-700 hover:underline break-all"
      >
        {children}
      </a>
    );
  },
};

export default function ChatMarkdown({
  content,
  className = "",
  streaming = false,
}: ChatMarkdownProps) {
  if (!content && !streaming) return null;

  return (
    <div className={`chat-md prose prose-sm max-w-none text-ink-900 ${className}`.trim()}>
      {content ? (
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      ) : null}
      {streaming && (
        <span className="inline-block w-0.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle rounded-full" />
      )}
    </div>
  );
}
