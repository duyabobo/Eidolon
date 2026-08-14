import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  knowledgeApi,
  KnowledgeBase,
  KnowledgeDocument,
  docStatusLabel,
} from "../api/knowledge";
import { formatChinaDateTime } from "../utils/datetime";
import { formatFileSize } from "../utils/formatFileSize";
import { ConfigActionBtn, ConfigPrimaryBtn, ConfigToolbarBtn } from "./config/ConfigActionBtn";
import { ConfigListItem } from "./config/ConfigListItem";
import {
  ConfigEmptyState,
  ConfigListPagination,
  ConfigListToolbar,
  ConfigPanelLayout,
} from "./config/ConfigPanelLayout";
import DocumentWikiExplorer from "./knowledge/DocumentWikiExplorer";
import { CONFIG_PAGE_SIZE } from "./config/useClientPagination";

const PAGE_SIZE = CONFIG_PAGE_SIZE;

function StatusBadge({ status }: { status: KnowledgeDocument["status"] }) {
  const cls = {
    uploaded: "bg-sky-50 text-sky-700",
    processing: "bg-amber-50 text-amber-700",
    indexed: "bg-emerald-50 text-emerald-700",
    failed: "bg-rose-50 text-rose-700",
  }[status];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>
      {docStatusLabel(status)}
    </span>
  );
}

function BaseModal({
  title,
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  title: string;
  initial?: { name: string; description: string };
  onSubmit: (name: string, description: string) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  return (
    <div className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60">
        <div className="px-6 py-4 border-b border-ink-200/60">
          <h2 className="font-semibold text-ink-900">{title}</h2>
        </div>
        <div className="px-6 py-4 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="知识库名称"
            className="ui-field w-full"
            autoFocus
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="描述（可选）"
            rows={2}
            className="ui-field w-full resize-none"
          />
        </div>
        <div className="px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-ink-200 rounded-xl">
            取消
          </button>
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => onSubmit(name.trim(), description.trim())}
            className="ui-btn-primary"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const DOC_POLL_INTERVAL_MS = 10_000;
const TERMINAL_DOC_STATUSES: KnowledgeDocument["status"][] = ["indexed", "failed"];

function isPendingDocument(status: KnowledgeDocument["status"]): boolean {
  return !TERMINAL_DOC_STATUSES.includes(status);
}

function DocumentSection({
  kb,
  deepLinkDocId,
  onBack,
}: {
  kb: KnowledgeBase;
  deepLinkDocId?: string;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [wikiDoc, setWikiDoc] = useState<KnowledgeDocument | null>(null);
  const [wikiLoading, setWikiLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const openWiki = useCallback((doc: KnowledgeDocument) => {
    setWikiDoc(doc);
    navigate(`/knowledge/bases/${encodeURIComponent(kb.id)}/documents/${encodeURIComponent(doc.id)}`);
  }, [kb.id, navigate]);

  const closeWiki = useCallback(() => {
    setWikiDoc(null);
    navigate(`/knowledge/bases/${encodeURIComponent(kb.id)}`);
  }, [kb.id, navigate]);

  const load = useCallback((silent = false, targetPage = page) => {
    if (!silent) setLoading(true);
    return knowledgeApi.listDocuments(kb.id, targetPage, PAGE_SIZE)
      .then((res) => {
        setDocs(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        if (!silent) {
          setDocs([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, [kb.id, page]);

  useEffect(() => { void load(false, page); }, [load, page]);

  const hasPendingDocs = docs.some((doc) => isPendingDocument(doc.status));

  useEffect(() => {
    if (!hasPendingDocs) return;
    const timer = setInterval(() => void load(true, page), DOC_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasPendingDocs, load, page]);

  useEffect(() => {
    if (!deepLinkDocId) return;
    const fromList = docs.find((doc) => doc.id === deepLinkDocId);
    if (fromList) {
      setWikiDoc(fromList);
      return;
    }
    setWikiLoading(true);
    knowledgeApi.getDocument(kb.id, deepLinkDocId)
      .then(setWikiDoc)
      .catch(() => {
        setWikiDoc(null);
        setErrMsg("文档不存在或无法加载");
      })
      .finally(() => setWikiLoading(false));
  }, [deepLinkDocId, docs, kb.id]);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setErrMsg(null);
    try {
      for (const file of Array.from(files)) {
        await knowledgeApi.uploadDocument(kb.id, file);
      }
      setPage(1);
      await load(false, 1);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (doc: KnowledgeDocument) => {
    if (!confirm(`确认删除文档「${doc.name}」？`)) return;
    await knowledgeApi.deleteDocument(kb.id, doc.id);
    if (wikiDoc?.id === doc.id) closeWiki();
    void load(false, page);
  };

  if (wikiLoading) {
    return <p className="text-sm text-ink-400 py-6">加载文档…</p>;
  }

  if (wikiDoc) {
    return (
      <DocumentWikiExplorer
        kbId={kb.id}
        doc={wikiDoc}
        onBack={closeWiki}
      />
    );
  }

  return (
    <ConfigPanelLayout
      loading={loading}
      loadingText="加载文档…"
      errMsg={errMsg}
      toolbar={(
        <ConfigListToolbar
          left={(
            <>
              <ConfigToolbarBtn onClick={onBack}>← 返回列表</ConfigToolbarBtn>
              <span className="text-sm font-medium text-ink-800 truncate">{kb.name}</span>
              <span className="text-xs text-ink-400">{total} 个文档</span>
            </>
          )}
          right={(
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.pptx"
                className="hidden"
                onChange={(e) => void handleUpload(e.target.files)}
              />
              <ConfigPrimaryBtn disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "添加中…" : "添加"}
              </ConfigPrimaryBtn>
            </>
          )}
        />
      )}
      pagination={(
        <ConfigListPagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
        />
      )}
    >
      <p className="text-xs text-ink-400 -mt-2">
        支持 pdf / docx / txt / md / csv / xlsx / pptx，单文件 ≤ 10MB
      </p>
      {docs.length === 0 ? (
        <ConfigEmptyState message="暂无文档，点击「添加」上传" />
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <ConfigListItem
              key={doc.id}
              title={doc.name}
              meta={<StatusBadge status={doc.status} />}
              subtitle={`${formatFileSize(doc.file_size)} · ${formatChinaDateTime(doc.created_at, {
                year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit", hour12: false,
              })}`}
              actions={(
                <>
                  <ConfigActionBtn
                    variant="violet"
                    disabled={doc.status !== "indexed"}
                    onClick={() => openWiki(doc)}
                  >
                    图谱
                  </ConfigActionBtn>
                  <ConfigActionBtn onClick={() => knowledgeApi.downloadDocument(kb.id, doc.id, doc.name)}>
                    下载
                  </ConfigActionBtn>
                  <ConfigActionBtn variant="danger" onClick={() => void handleDelete(doc)}>删除</ConfigActionBtn>
                </>
              )}
            />
          ))}
        </div>
      )}
    </ConfigPanelLayout>
  );
}

export default function KnowledgePanel({
  deepLinkKbId,
  deepLinkDocId,
}: {
  userId?: string;
  deepLinkKbId?: string;
  deepLinkDocId?: string;
}) {
  const navigate = useNavigate();
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkKbId ?? null);
  const [baseModal, setBaseModal] = useState<{ mode: "create" } | { mode: "edit"; kb: KnowledgeBase } | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null);
  const [selectedKbLoading, setSelectedKbLoading] = useState(false);

  useEffect(() => {
    if (deepLinkKbId) setSelectedId(deepLinkKbId);
  }, [deepLinkKbId]);

  const loadBases = useCallback(async (targetPage = page) => {
    setLoading(true);
    setErrMsg(null);
    try {
      const res = await knowledgeApi.listBases(targetPage, PAGE_SIZE);
      let items = res.items;
      if (deepLinkKbId && !items.some((kb) => kb.id === deepLinkKbId)) {
        try {
          const kb = await knowledgeApi.getBase(deepLinkKbId);
          items = [...items, kb];
        } catch {
          setErrMsg("知识库不存在或无法访问");
        }
      }
      setBases(items);
      setTotal(res.total);
    } catch (e) {
      setBases([]);
      setTotal(0);
      setErrMsg(e instanceof Error ? e.message : "加载知识库失败");
    } finally {
      setLoading(false);
    }
  }, [deepLinkKbId, page]);

  useEffect(() => { void loadBases(page); }, [loadBases, page]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedKb(null);
      return;
    }
    const fromList = bases.find((b) => b.id === selectedId);
    if (fromList) {
      setSelectedKb(fromList);
      return;
    }
    setSelectedKbLoading(true);
    knowledgeApi.getBase(selectedId)
      .then(setSelectedKb)
      .catch(() => {
        setSelectedKb(null);
        setErrMsg("知识库不存在或无法访问");
        setSelectedId(null);
        navigate("/knowledge");
      })
      .finally(() => setSelectedKbLoading(false));
  }, [selectedId, bases, navigate]);

  const selected = selectedKb;

  const handleCreate = async (name: string, description: string) => {
    setErrMsg(null);
    try {
      const kb = await knowledgeApi.createBase({ name, description, type: "document" });
      setBaseModal(null);
      setSelectedId(kb.id);
      navigate(`/knowledge/bases/${encodeURIComponent(kb.id)}`);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "创建失败");
    }
  };

  const handleUpdate = async (kbId: string, name: string, description: string) => {
    setErrMsg(null);
    try {
      await knowledgeApi.updateBase(kbId, { name, description });
      setBaseModal(null);
      void loadBases(page);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "保存失败");
    }
  };

  const handleDelete = async (kb: KnowledgeBase) => {
    if (!confirm(`确认删除知识库「${kb.name}」及其全部文档？`)) return;
    await knowledgeApi.deleteBase(kb.id);
    if (selectedId === kb.id) setSelectedId(null);
    void loadBases(page);
  };

  const openKnowledgeBase = (kbId: string) => {
    setErrMsg(null);
    setSelectedId(kbId);
    navigate(`/knowledge/bases/${encodeURIComponent(kbId)}`);
  };

  const handleBackToBaseList = () => {
    setSelectedId(null);
    navigate("/knowledge");
    void loadBases(page);
  };

  if (selectedId && selectedKbLoading) {
    return <p className="text-sm text-ink-400 py-6">加载知识库…</p>;
  }

  if (selected) {
    return (
      <DocumentSection
        kb={selected}
        deepLinkDocId={deepLinkDocId}
        onBack={handleBackToBaseList}
      />
    );
  }

  return (
    <ConfigPanelLayout
      loading={loading}
      loadingText="加载知识库…"
      errMsg={errMsg}
      toolbar={(
        <ConfigListToolbar
          left={<span className="text-sm font-medium text-ink-800">知识库</span>}
          right={(
            <ConfigPrimaryBtn onClick={() => setBaseModal({ mode: "create" })}>添加</ConfigPrimaryBtn>
          )}
        />
      )}
      pagination={(
        <ConfigListPagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
        />
      )}
    >
      {bases.length === 0 ? (
        <ConfigEmptyState message="暂无知识库" />
      ) : (
        <div className="space-y-2">
          {bases.map((kb) => (
            <ConfigListItem
              key={kb.id}
              title={kb.name}
              subtitle={`${kb.description || "无描述"} · ${kb.document_count} 个文档`}
              actions={(
                <>
                  <ConfigActionBtn variant="brand" onClick={() => openKnowledgeBase(kb.id)}>文档</ConfigActionBtn>
                  <ConfigActionBtn onClick={() => setBaseModal({ mode: "edit", kb })}>编辑</ConfigActionBtn>
                  <ConfigActionBtn variant="danger" onClick={() => void handleDelete(kb)}>删除</ConfigActionBtn>
                </>
              )}
            />
          ))}
        </div>
      )}

      {baseModal?.mode === "create" && (
        <BaseModal
          title="新建知识库"
          submitLabel="创建"
          onSubmit={handleCreate}
          onCancel={() => setBaseModal(null)}
        />
      )}
      {baseModal?.mode === "edit" && (
        <BaseModal
          title={`编辑 · ${baseModal.kb.name}`}
          initial={{ name: baseModal.kb.name, description: baseModal.kb.description }}
          submitLabel="保存"
          onSubmit={(name, desc) => void handleUpdate(baseModal.kb.id, name, desc)}
          onCancel={() => setBaseModal(null)}
        />
      )}
    </ConfigPanelLayout>
  );
}
