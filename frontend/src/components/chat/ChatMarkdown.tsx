import { useMemo, useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { isWikiNodeHref, wikiNodeIdFromHref } from "../knowledge/wikiMarkdownLinks";
import { preprocessChatMarkdown } from "./chatMarkdownPreprocess";
import ChatWikiNodeModal from "./ChatWikiNodeModal";

interface ChatMarkdownProps {
  content: string;
  className?: string;
  streaming?: boolean;
  /** plain：wiki 链接仅展示；modal：点击 wiki 链接弹框渲染详情 */
  linkMode?: "modal" | "plain";
}

function buildMarkdownComponents(
  linkMode: "modal" | "plain",
  onWikiNodeClick: (nodeId: string) => void,
): Components {
  return {
    a: ({ href, children }) => {
      if (!href) return <span>{children}</span>;

      if (isWikiNodeHref(href)) {
        if (linkMode === "plain") {
          return <span className="text-brand-600 break-all">{children}</span>;
        }
        return (
          <button
            type="button"
            onClick={() => onWikiNodeClick(wikiNodeIdFromHref(href))}
            className="text-brand-600 hover:text-brand-700 hover:underline break-all inline text-left"
          >
            {children}
          </button>
        );
      }

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
}

export default function ChatMarkdown({
  content,
  className = "",
  streaming = false,
  linkMode = "modal",
}: ChatMarkdownProps) {
  const [wikiNodeId, setWikiNodeId] = useState<string | null>(null);

  const components = useMemo(
    () => buildMarkdownComponents(linkMode, (nodeId) => setWikiNodeId(nodeId)),
    [linkMode],
  );

  if (!content && !streaming) return null;

  const processed = content ? preprocessChatMarkdown(content) : "";

  return (
    <>
      <div className={`chat-md prose prose-sm max-w-none text-ink-900 ${className}`.trim()}>
        {processed ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={components}
          >
            {processed}
          </ReactMarkdown>
        ) : null}
        {streaming && (
          <span className="inline-block w-0.5 h-4 bg-brand-400 animate-pulse ml-0.5 align-middle rounded-full" />
        )}
      </div>

      {wikiNodeId && linkMode === "modal" && (
        <ChatWikiNodeModal
          nodeId={wikiNodeId}
          onClose={() => setWikiNodeId(null)}
        />
      )}
    </>
  );
}
