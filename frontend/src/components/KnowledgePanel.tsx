import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  knowledgeApi, KnowledgeBase, KnowledgeDocument, KnowledgeServiceConfig,
  ensureKnowledgeKey, formatFileSize, docStatusLabel,
} from "../api/knowledge";
import { setKnowledgeSceneUid } from "../api/knowledgeKeyCache";
import DocumentWikiExplorer from "./knowledge/DocumentWikiExplorer";

const EMPTY_SERVICE: KnowledgeServiceConfig = { base_url: "", environment: "local" };

function KnowledgeServiceSection({
  userId,
  onSaved,
}: {
  userId: string;
  onSaved: (saved: KnowledgeServiceConfig) => void | Promise<void>;
}) {
  const [form, setForm] = useState<KnowledgeServiceConfig>(EMPTY_SERVICE);
  const [envOptions, setEnvOptions] = useState<Array<{ id: KnowledgeServiceConfig["environment"]; label: string; base_url: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "err"; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    const [cfg, envs] = await Promise.all([
      knowledgeApi.getServiceConfig(),
      knowledgeApi.listServiceEnvironments(),
    ]);
    setForm(cfg);
    setEnvOptions(envs.items);
    setKnowledgeSceneUid(userId.trim());
  }, [userId]);

  useEffect(() => {
    loadConfig()
      .catch(() => setForm(EMPTY_SERVICE))
      .finally(() => setLoading(false));
  }, [loadConfig]);

  const handleEnvironmentChange = async (environment: KnowledgeServiceConfig["environment"]) => {
    if (!environment || environment === form.environment) return;
    if (environment !== "local" && !userId.trim()) {
      setMsg({ type: "err", text: "请先在「历史」页设置用户 ID" });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const saved = await knowledgeApi.saveServiceConfig({ environment, base_url: "" });
      setForm(saved);
      await onSaved(saved);
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "切换失败" });
    } finally {
      setSaving(false);
    }
  };

  const currentEnv = form.environment ?? "local";

  return (
    <div className="border border-ink-200/60 rounded-xl p-4 bg-ink-50/40">
      {loading ? (
        <p className="text-sm text-ink-400">加载配置…</p>
      ) : (
        <>
          <select
            value={currentEnv}
            disabled={saving}
            onChange={(e) => void handleEnvironmentChange(e.target.value as KnowledgeServiceConfig["environment"])}
            className="ui-field w-full"
          >
            {(envOptions.length ? envOptions : [
              { id: "local" as const, label: "本地", base_url: "" },
              { id: "prod" as const, label: "线上", base_url: "" },
              { id: "test" as const, label: "测试", base_url: "" },
            ]).map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          {msg?.type === "err" && (
            <p className="text-sm px-3 py-2 rounded-lg mt-3 bg-rose-50 text-rose-700">
              {msg.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}

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

function DocumentSection({
  kb,
  deepLinkDocId,
}: {
  kb: KnowledgeBase;
  deepLinkDocId?: string;
}) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [wikiDoc, setWikiDoc] = useState<KnowledgeDocument | null>(null);
  const [wikiLoading, setWikiLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const openWiki = useCallback((doc: KnowledgeDocument) => {
    setWikiDoc(doc);
    navigate(`/admin/knowledge/bases/${encodeURIComponent(kb.id)}/documents/${encodeURIComponent(doc.id)}`);
  }, [kb.id, navigate]);

  const closeWiki = useCallback(() => {
    setWikiDoc(null);
    navigate("/admin?tab=knowledge");
  }, [navigate]);

  const load = useCallback(() => {
    setLoading(true);
    knowledgeApi.listDocuments(kb.id)
      .then((res) => setDocs(res.items))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [kb.id]);

  useEffect(() => { load(); }, [load]);

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
        setMsg({ type: "err", text: "文档不存在或无法加载" });
      })
      .finally(() => setWikiLoading(false));
  }, [deepLinkDocId, docs, kb.id]);

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
    if (wikiDoc?.id === doc.id) closeWiki();
    load();
  };

  if (wikiLoading) {
    return <p className="text-sm text-ink-400">加载文档…</p>;
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
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-ink-400 mt-0.5">{kb.description || "暂无描述"}</p>
          <p className="text-[11px] text-ink-400 mt-1">
            支持 pdf / docx / txt / md / csv / xlsx / pptx，单文件 ≤ 10MB · 点击文档查看 Wiki 知识图谱
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
              <button
                type="button"
                onClick={() => openWiki(doc)}
                className="flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-ink-800 truncate">{doc.name}</span>
                  <StatusBadge status={doc.status} />
                </div>
                <p className="text-xs text-ink-400 mt-0.5">
                  {formatFileSize(doc.file_size)} · {new Date(doc.created_at).toLocaleString("zh-CN")}
                </p>
              </button>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => openWiki(doc)}
                  className="text-xs px-3 py-1 border border-violet-200 rounded-lg text-violet-700 hover:bg-violet-50"
                >
                  图谱
                </button>
                <button
                  type="button"
                  onClick={() => knowledgeApi.downloadDocument(kb.id, doc.id, doc.name)}
                  className="text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50"
                >
                  下载
                </button>
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

export default function KnowledgePanel({
  userId,
  deepLinkKbId,
  deepLinkDocId,
}: {
  userId: string;
  deepLinkKbId?: string;
  deepLinkDocId?: string;
}) {
  const navigate = useNavigate();
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkKbId ?? null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (deepLinkKbId) setSelectedId(deepLinkKbId);
  }, [deepLinkKbId]);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const cfg = await knowledgeApi.getServiceConfig();
      if (cfg.base_url?.trim() && !userId.trim()) {
        setBases([]);
        setMsg({ type: "err", text: "请先在「历史」页设置用户 ID" });
        return;
      }
      await ensureKnowledgeKey(cfg, userId);
      const res = await knowledgeApi.listBases();
      let items = res.items;
      if (deepLinkKbId && !items.some((kb) => kb.id === deepLinkKbId)) {
        try {
          const kb = await knowledgeApi.getBase(deepLinkKbId);
          items = [...items, kb];
        } catch {
          setMsg({ type: "err", text: "知识库不存在或无法访问" });
        }
      }
      setBases(items);
    } catch (e) {
      setBases([]);
      setMsg({ type: "err", text: e instanceof Error ? e.message : "加载知识库失败" });
    } finally {
      setLoading(false);
    }
  }, [userId, deepLinkKbId]);

  useEffect(() => { void load(); }, [load]);

  const handleServiceConfigSaved = useCallback(async (saved: KnowledgeServiceConfig) => {
    setSelectedId(null);
    setEditingId(null);
    setLoading(true);
    setMsg(null);
    try {
      await ensureKnowledgeKey(saved, userId, true);
      const res = await knowledgeApi.listBases();
      setBases(res.items);
    } catch (e) {
      setBases([]);
      setMsg({ type: "err", text: e instanceof Error ? e.message : "刷新知识库失败" });
    } finally {
      setLoading(false);
    }
  }, [userId]);

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

  const handleBackToBaseList = () => {
    setSelectedId(null);
    navigate("/admin?tab=knowledge");
    void load();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <KnowledgeServiceSection userId={userId} onSaved={handleServiceConfigSaved} />
        <div className="text-sm text-ink-400">加载知识库…</div>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <KnowledgeServiceSection userId={userId} onSaved={handleServiceConfigSaved} />
        <button
          type="button"
          onClick={handleBackToBaseList}
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
        <DocumentSection kb={selected} deepLinkDocId={deepLinkDocId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <KnowledgeServiceSection userId={userId} onSaved={handleServiceConfigSaved} />

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
