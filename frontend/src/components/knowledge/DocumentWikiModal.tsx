import type { KnowledgeDocument } from "../../api/knowledge";
import { ModalOverlay } from "../config/ModalOverlay";
import DocumentWikiExplorer from "./DocumentWikiExplorer";

export const WIKI_GRAPH_READY_STATUS = "indexed";

export function canOpenWikiGraph(status?: string | null, wikiCompiled?: boolean): boolean {
  return status === WIKI_GRAPH_READY_STATUS || Boolean(wikiCompiled);
}

export function knowledgeDocFromUpload(params: {
  docId: string;
  kbId: string;
  name: string;
  fileSize?: number;
  status?: KnowledgeDocument["status"];
  wikiCompiled?: boolean;
}): KnowledgeDocument {
  const now = new Date().toISOString();
  const status = params.status ?? "uploaded";
  return {
    id: params.docId,
    kb_id: params.kbId,
    name: params.name,
    file_size: params.fileSize ?? 0,
    status,
    error_message: null,
    wiki_compiled: params.wikiCompiled ?? false,
    created_at: now,
    updated_at: now,
  };
}

interface Props {
  kbId: string;
  doc: KnowledgeDocument;
  onClose: () => void;
}

export default function DocumentWikiModal({ kbId, doc, onClose }: Props) {
  return (
    <ModalOverlay zClass="z-[70]" onBackdropClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-panel w-full max-w-5xl h-[90vh] border border-ink-200/60 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${doc.name} 图谱`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-ink-200/60 shrink-0">
          <h2 className="font-semibold text-ink-900 truncate">图谱 · {doc.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-2.5 py-1.5 border border-ink-200 rounded-lg text-ink-500 hover:bg-ink-50"
          >
            关闭
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto overscroll-contain scrollbar-thin flex-1 min-h-0">
          <DocumentWikiExplorer
            kbId={kbId}
            doc={doc}
            onBack={onClose}
            hideBack
          />
        </div>
      </div>
    </ModalOverlay>
  );
}
