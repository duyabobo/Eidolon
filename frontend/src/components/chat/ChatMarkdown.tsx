import { useCallback, useMemo, useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { isolateHtmlTables } from "../knowledge/wikiHtmlTables";
import { isWikiNodeHref, wikiAwareUrlTransform, wikiNodeIdFromHref } from "../knowledge/wikiMarkdownLinks";
import { wikiSanitizeSchema } from "../knowledge/wikiMarkdownSanitize";
import {
  citeRefNumberFromHref,
  isCiteRefHref,
  parseChatCitations,
  type CitationRef,
} from "./chatCitationParse";
import { preprocessChatMarkdown } from "./chatMarkdownPreprocess";
import ChatWikiNodeModal from "./ChatWikiNodeModal";

interface ChatMarkdownProps {
  content: string;
  className?: string;
  streaming?: boolean;
  /** plain：引用链接仅展示；modal：点击后弹框或新开页签 */
  linkMode?: "modal" | "plain";
}

const EXTERNAL_LINK_PATTERN = /^https?:\/\//i;

function buildMarkdownComponents(
  linkMode: "modal" | "plain",
  refs: Map<number, CitationRef>,
  onCitationClick: (href: string) => void,
): Components {
  return {
    a: ({ href, children }) => {
      if (!href) return <span>{children}</span>;

      if (isCiteRefHref(href)) {
        const num = citeRefNumberFromHref(href);
        const ref = refs.get(num);
        if (!ref || linkMode === "plain") {
          return <sup className="text-[10px] text-brand-600 font-semibold">{num}</sup>;
        }
        return (
          <button
            type="button"
            onClick={() => onCitationClick(ref.href)}
            className="inline p-0 border-0 bg-transparent cursor-pointer align-baseline text-brand-600 hover:text-brand-700"
            aria-label={`参考来源 ${num}：${ref.label}`}
          >
            <sup className="text-[10px] font-semibold">{num}</sup>
          </button>
        );
      }

      if (isWikiNodeHref(href)) {
        if (linkMode === "plain") {
          return <span className="text-brand-600 break-all">{children}</span>;
        }
        return (
          <button
            type="button"
            onClick={() => onCitationClick(href)}
            className="text-brand-600 hover:text-brand-700 hover:underline break-all inline text-left"
          >
            {children}
          </button>
        );
      }

      if (EXTERNAL_LINK_PATTERN.test(href) && linkMode === "modal") {
        return (
          <button
            type="button"
            onClick={() => onCitationClick(href)}
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

  const { markdown, refs } = useMemo(() => {
    if (!content) return { markdown: "", refs: new Map<number, CitationRef>() };
    const base = isolateHtmlTables(preprocessChatMarkdown(content));
    return parseChatCitations(base);
  }, [content]);

  const handleCitationClick = useCallback((href: string) => {
    if (isWikiNodeHref(href)) {
      setWikiNodeId(wikiNodeIdFromHref(href));
      return;
    }
    if (EXTERNAL_LINK_PATTERN.test(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }, []);

  const components = useMemo(
    () => buildMarkdownComponents(linkMode, refs, handleCitationClick),
    [linkMode, refs, handleCitationClick],
  );

  if (!content && !streaming) return null;

  return (
    <>
      <div className={`chat-md prose prose-sm max-w-none text-ink-900 ${className}`.trim()}>
        {markdown ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeRaw, [rehypeSanitize, wikiSanitizeSchema], rehypeKatex]}
            components={components}
            urlTransform={wikiAwareUrlTransform}
          >
            {markdown}
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
