import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import type { WikiGraphNode } from "../../api/knowledge";
import {
  buildTitleNodeIndex,
  isWikiNodeHref,
  preprocessConnectionLines,
  preprocessWikiMarkdown,
  wikiAwareUrlTransform,
  wikiNodeIdFromHref,
} from "./wikiMarkdownLinks";
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
  const withConnections = preprocessConnectionLines(withStructured, graphNodes);
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
  };

  return (
    <div className={`wiki-md prose prose-sm max-w-none text-ink-800 ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
        urlTransform={wikiAwareUrlTransform}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
