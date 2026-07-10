import { useEffect } from "react";
import ChatMarkdown from "./ChatMarkdown";

interface ChatExternalLinkModalProps {
  href: string;
  label: string;
  onClose: () => void;
}

export default function ChatExternalLinkModal({ href, label, onClose }: ChatExternalLinkModalProps) {
  const content = `### ${label}\n\n${href}`;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/30 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60 max-h-[85vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="参考来源"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-200/60">
          <h2 className="font-semibold text-ink-900 truncate">{label || "参考来源"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-2 py-1 border border-ink-200 rounded-lg text-ink-500 hover:bg-ink-50 shrink-0"
          >
            关闭
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto scrollbar-thin">
          <ChatMarkdown content={content} linkMode="plain" />
        </div>
      </div>
    </div>
  );
}
