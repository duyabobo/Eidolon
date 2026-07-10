import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { preprocessChatMarkdown } from "./chatMarkdownPreprocess";

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
  table: ({ children }) => (
    <div className="chat-md-table-wrap overflow-x-auto -mx-1 px-1 my-2">
      <table>{children}</table>
    </div>
  ),
};

export default function ChatMarkdown({
  content,
  className = "",
  streaming = false,
}: ChatMarkdownProps) {
  if (!content && !streaming) return null;

  const processed = content ? preprocessChatMarkdown(content) : "";

  return (
    <div className={`chat-md prose prose-sm max-w-none text-ink-900 ${className}`.trim()}>
      {processed ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={markdownComponents}
        >
          {processed}
        </ReactMarkdown>
      ) : null}
      {streaming && (
        <span className="inline-block w-0.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle rounded-full" />
      )}
    </div>
  );
}
