import { useMemo, useState, type ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { isWikiNodeHref, wikiNodeIdFromHref } from "../knowledge/wikiMarkdownLinks";
import { preprocessChatMarkdown } from "./chatMarkdownPreprocess";
import ChatExternalLinkModal from "./ChatExternalLinkModal";
import ChatWikiNodeModal from "./ChatWikiNodeModal";

interface ChatMarkdownProps {
  content: string;
  className?: string;
  streaming?: boolean;
  /** plain：链接仅展示，不弹框；modal：参考来源链接点击后弹框渲染 */
  linkMode?: "modal" | "plain";
}

const EXTERNAL_LINK_PATTERN = /^https?:\/\//i;

function linkLabel(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    return children.map((child) => (typeof child === "string" ? child : "")).join("").trim();
  }
  return "";
}

function buildMarkdownComponents(
  linkMode: "modal" | "plain",
  onWikiNodeClick: (nodeId: string) => void,
  onExternalLinkClick: (href: string, label: string) => void,
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

      if (EXTERNAL_LINK_PATTERN.test(href)) {
        if (linkMode === "plain") {
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
        }
        return (
          <button
            type="button"
            onClick={() => onExternalLinkClick(href, linkLabel(children) || href)}
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
  const [externalLink, setExternalLink] = useState<{ href: string; label: string } | null>(null);

  const components = useMemo(
    () => buildMarkdownComponents(
      linkMode,
      (nodeId) => setWikiNodeId(nodeId),
      (href, label) => setExternalLink({ href, label }),
    ),
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

      {wikiNodeId && (
        <ChatWikiNodeModal
          nodeId={wikiNodeId}
          onClose={() => setWikiNodeId(null)}
        />
      )}

      {externalLink && (
        <ChatExternalLinkModal
          href={externalLink.href}
          label={externalLink.label}
          onClose={() => setExternalLink(null)}
        />
      )}
    </>
  );
}
