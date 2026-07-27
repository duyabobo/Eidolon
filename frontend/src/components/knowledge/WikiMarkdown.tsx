import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import type { WikiGraphNode } from "../../api/knowledge";
import { isolateHtmlTables } from "./wikiHtmlTables";
import {
  buildTitleNodeIndex,
  isWikiNodeHref,
  preprocessConnectionLines,
  preprocessWikiMarkdown,
  wikiAwareUrlTransform,
  wikiNodeIdFromHref,
} from "./wikiMarkdownLinks";
import { wikiSanitizeSchema } from "./wikiMarkdownSanitize";
import { preprocessStructuredFields } from "./wikiStructuredText";

interface WikiMarkdownProps {
  content: string;
  className?: string;
  graphNodes?: WikiGraphNode[];
  onWikiNodeClick?: (target: string) => void;
}

export default function WikiMarkdown({
  content,
  className = "",
  graphNodes = [],
  onWikiNodeClick,
}: WikiMarkdownProps) {
  const text = content.trim();
  if (!text) return null;

  const titleIndex = buildTitleNodeIndex(graphNodes);
  const withStructured = preprocessStructuredFields(text);
  const withTables = isolateHtmlTables(withStructured);
  const withConnections = preprocessConnectionLines(withTables, graphNodes);
  const processed = preprocessWikiMarkdown(withConnections, titleIndex);

  const components: Components = {
    a: ({ href, children }) => {
      if (href && isWikiNodeHref(href) && onWikiNodeClick) {
        const nodeId = wikiNodeIdFromHref(href);
        return (
          <button
            type="button"
            onClick={() => onWikiNodeClick(nodeId)}
            className="text-brand-600 hover:text-brand-700 hover:underline font-medium inline align-baseline"
          >
            {children}
          </button>
        );
      }
      if (!href) {
        return <span>{children}</span>;
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
      <div
        className="wiki-md-table-wrap my-3"
        role="region"
        aria-label="数据表格，可横向滚动"
        tabIndex={0}
      >
        <table>{children}</table>
      </div>
    ),
  };

  return (
    <div className={`wiki-md prose prose-sm max-w-none text-ink-800 ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, wikiSanitizeSchema], rehypeKatex]}
        components={components}
        urlTransform={wikiAwareUrlTransform}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
