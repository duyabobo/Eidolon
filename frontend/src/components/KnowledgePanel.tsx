import { useCallback, useEffect, useRef, useState } from "react";
import {
  knowledgeApi, KnowledgeBase, KnowledgeDocument,
  formatFileSize, docStatusLabel,
} from "../api/knowledge";

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

function BaseForm({
  initial, onSubmit, onCancel, submitLabel,
}: {
  initial?: { name: string; description: string };
  onSubmit: (name: string, description: string) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  return (
    <div className="border border-ink-200/60 rounded-xl p-4 space-y-3 bg-ink-50/30">
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
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => onSubmit(name.trim(), description.trim())}
          className="ui-btn-primary flex-1"
        >
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="flex-1 py-2.5 text-sm border border-ink-200 rounded-xl">
          取消
        </button>
      </div>
    </div>
  );
}

function DocumentSection({ kb }: { kb: KnowledgeBase }) {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    knowledgeApi.listDocuments(kb.id)
      .then((res) => setDocs(res.items))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [kb.id]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setMsg(null);
    try {
      for (const file of Array.from(files)) {
        await knowledgeApi.uploadDocument(kb.id, file);
      }
      setMsg({ type: "ok", text: "文档上传成功" });
      load();
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "上传失败" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (doc: KnowledgeDocument) => {
    if (!confirm(`确认删除文档「${doc.name}」？`)) return;
    await knowledgeApi.deleteDocument(kb.id, doc.id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-ink-400 mt-0.5">{kb.description || "暂无描述"}</p>
          <p className="text-[11px] text-ink-400 mt-1">
            支持 pdf / docx / txt / md / csv / xlsx / pptx，单文件 ≤ 10MB
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.pptx"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="ui-btn-primary text-sm"
          >
            {uploading ? "上传中…" : "上传文档"}
          </button>
        </div>
      </div>

      {msg && (
        <p className={`text-sm px-3 py-2 rounded-lg ${
          msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
        }`}>
          {msg.text}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-400">加载文档…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-ink-400 text-center py-10 border border-dashed border-ink-200 rounded-xl">
          暂无文档，点击「上传文档」添加
        </p>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 border border-ink-200/60 rounded-xl px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-ink-800 truncate">{doc.name}</span>
                  <StatusBadge status={doc.status} />
                </div>
                <p className="text-xs text-ink-400 mt-0.5">
                  {formatFileSize(doc.file_size)} · {new Date(doc.created_at).toLocaleString("zh-CN")}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <a
                  href={knowledgeApi.downloadUrl(kb.id, doc.id)}
                  className="text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50"
                  download
                >
                  下载
                </a>
                <button
                  type="button"
                  onClick={() => handleDelete(doc)}
                  className="text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function KnowledgePanel() {
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    knowledgeApi.listBases()
      .then((res) => setBases(res.items))
      .catch(() => setBases([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = bases.find((b) => b.id === selectedId) ?? null;

  const handleCreate = async (name: string, description: string) => {
    setMsg(null);
    try {
      const kb = await knowledgeApi.createBase({ name, description, type: "document" });
      setShowCreate(false);
      setSelectedId(kb.id);
      load();
      setMsg({ type: "ok", text: `知识库「${name}」已创建` });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "创建失败" });
    }
  };

  const handleUpdate = async (kbId: string, name: string, description: string) => {
    setMsg(null);
    try {
      await knowledgeApi.updateBase(kbId, { name, description });
      setEditingId(null);
      load();
      setMsg({ type: "ok", text: "已保存" });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "保存失败" });
    }
  };

  const handleDelete = async (kb: KnowledgeBase) => {
    if (!confirm(`确认删除知识库「${kb.name}」及其全部文档？`)) return;
    await knowledgeApi.deleteBase(kb.id);
    if (selectedId === kb.id) setSelectedId(null);
    load();
  };

  if (loading) return <div className="text-sm text-ink-400">加载中…</div>;

  if (selected) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1"
        >
          ← 返回知识库列表
        </button>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink-900">{selected.name}</h2>
          <span className="text-xs text-ink-400">{selected.document_count} 个文档</span>
        </div>
        {msg && (
          <p className={`text-sm px-3 py-2 rounded-lg ${
            msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}>
            {msg.text}
          </p>
        )}
        <DocumentSection kb={selected} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-500">
        本地知识库：元数据存 MongoDB，文档文件存共享目录（global/knowledge/）。
      </p>

      {msg && (
        <p className={`text-sm px-3 py-2 rounded-lg ${
          msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
        }`}>
          {msg.text}
        </p>
      )}

      {showCreate ? (
        <BaseForm submitLabel="创建" onSubmit={handleCreate} onCancel={() => setShowCreate(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-full py-2.5 border-2 border-dashed border-brand-300/80 text-brand-700 text-sm rounded-xl hover:bg-brand-50/50 transition-colors"
        >
          + 新建知识库
        </button>
      )}

      {bases.length === 0 ? (
        <p className="text-sm text-ink-400 text-center py-10 border border-dashed border-ink-200 rounded-xl">
          暂无知识库
        </p>
      ) : (
        <div className="space-y-2">
          {bases.map((kb) => (
            <div key={kb.id} className="border border-ink-200/60 rounded-xl overflow-hidden">
              {editingId === kb.id ? (
                <div className="p-4">
                  <BaseForm
                    initial={{ name: kb.name, description: kb.description }}
                    submitLabel="保存"
                    onSubmit={(name, desc) => handleUpdate(kb.id, name, desc)}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId(kb.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-sm font-medium text-ink-800 truncate">{kb.name}</p>
                    <p className="text-xs text-ink-400 mt-0.5 truncate">
                      {kb.description || "无描述"} · {kb.document_count} 个文档
                    </p>
                  </button>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedId(kb.id)}
                      className="text-xs px-3 py-1 border border-brand-200 rounded-lg text-brand-700 hover:bg-brand-50"
                    >
                      文档
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(kb.id)}
                      className="text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(kb)}
                      className="text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50"
                    >
                      删除
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
