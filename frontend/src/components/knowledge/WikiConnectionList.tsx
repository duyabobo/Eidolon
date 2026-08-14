import type { WikiConnectionLink } from "./wikiConnections";
import WikiInlineMarkdown from "./WikiInlineMarkdown";

interface WikiConnectionListProps {
  links: WikiConnectionLink[];
  onNavigate: (target: string) => void;
}

export default function WikiConnectionList({ links, onNavigate }: WikiConnectionListProps) {
  if (!links.length) return null;

  return (
    <ul className="space-y-2.5">
      {links.map((link) => {
        const clickable = Boolean(link.nodeId);
        return (
          <li key={`${link.nodeId || link.label}-${link.description}`} className="text-sm leading-relaxed">
            {clickable ? (
              <button
                type="button"
                onClick={() => onNavigate(link.nodeId)}
                className="text-brand-600 hover:text-brand-700 underline underline-offset-2 font-medium text-left inline"
              >
                <WikiInlineMarkdown content={link.label} />
              </button>
            ) : (
              <WikiInlineMarkdown content={link.label} className="text-ink-800 font-medium" />
            )}
            {link.description ? (
              <>
                <span className="text-ink-600"> — </span>
                <WikiInlineMarkdown content={link.description} className="text-ink-600" />
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
