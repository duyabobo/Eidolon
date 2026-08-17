import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceApi, type WorkspaceEntry, type WorkspaceListResponse } from "../../api/workspace";
import {
  PI_SESSIONS_DIR,
  SESSION_ZONE_ARTIFACTS,
  SESSION_ZONE_SESSION_MEMORY,
  SESSION_ZONE_UPLOADS,
  SESSION_ZONES,
  artifactsDisplayRel,
  isHiddenInArtifactsZone,
  isPathWithinZone,
  isPiSessionFileForSession,
  joinWorkspacePath,
  mergeArtifactsRootEntries,
  relativeWithinZone,
  sessionArtifactsDir,
  sessionWorkspaceRoot,
  sessionZoneRoot,
  type SessionZone,
} from "../../constants/sessionWorkspace";
import { formatFileSize, formatOptionalMtime } from "../../utils/formatFileSize";
import FilePreviewModal, { type FilePreviewSource } from "../FilePreviewModal";
import TruncatedFilename from "../TruncatedFilename";
import { ConfigActionBtn, ConfigPrimaryBtn } from "../config/ConfigActionBtn";
import { ConfigEmptyState, ConfigPanelLayout } from "../config/ConfigPanelLayout";
import DocumentWikiModal, {
  canOpenWikiGraph,
  knowledgeDocFromUpload,
} from "../knowledge/DocumentWikiModal";
import type { KnowledgeDocument } from "../../api/knowledge";

const DOC_POLL_INTERVAL_MS = 10_000;

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
}

/**
 * 会话级虚拟文件系统：
 * artifacts（只读）/ uploads（可写）/ session-memory（pi 会话 JSONL，只读）。
 */
export default function SessionFilesDrawer({ open, onClose, sessionId }: Props) {
  const [zone, setZone] = useState<SessionZone>(SESSION_ZONE_UPLOADS);
  const [currentPath, setCurrentPath] = useState("");
  const [listing, setListing] = useState<WorkspaceListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const [wikiDoc, setWikiDoc] = useState<KnowledgeDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const zoneRoot = sessionId ? sessionZoneRoot(sessionId, zone) : null;
  const zoneMeta = SESSION_ZONES.find((item) => item.id === zone);
  const canWrite = Boolean(zoneMeta?.writable && listing?.writable);

  const isWithinZone = useCallback(
    (path: string) => !!zoneRoot && isPathWithinZone(path, zoneRoot),
    [zoneRoot],
  );

  const load = useCallback(
    async (path: string) => {
      if (!zoneRoot || !sessionId) return;
      setLoading(true);
      setErrMsg(null);
      try {
        const workspaceRoot = sessionWorkspaceRoot(sessionId);
        const artifactsDir = sessionArtifactsDir(sessionId);
        const listPath =
          zone === SESSION_ZONE_ARTIFACTS && path === artifactsDir ? workspaceRoot : path;
        if (zone === SESSION_ZONE_ARTIFACTS && listPath === workspaceRoot) {
          const [rootRes, artRes] = await Promise.all([
            workspaceApi.ls(workspaceRoot),
            workspaceApi.ls(artifactsDir).catch(() => null),
          ]);
          setListing({
            ...rootRes,
            entries: mergeArtifactsRootEntries(rootRes.entries, artRes?.entries ?? []),
          });
          setCurrentPath(workspaceRoot);
          return;
        }
        const res = await workspaceApi.ls(listPath);
        setListing(res);
        setCurrentPath(res.path);
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    },
    [zoneRoot, zone, sessionId],
  );

  useEffect(() => {
    if (open && zoneRoot) {
      setListing(null);
      setMkdirOpen(false);
      void load(zoneRoot);
    }
  }, [open, zoneRoot, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !preview && !wikiDoc) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, preview, wikiDoc]);

  const hasPendingWiki = (listing?.entries ?? []).some(
    (entry) =>
      Boolean(entry.doc_id) &&
      !canOpenWikiGraph(entry.knowledge_status, entry.wiki_compiled),
  );

  useEffect(() => {
    if (!open || !hasPendingWiki || !zoneRoot) return undefined;
    const timer = setInterval(() => void load(currentPath || zoneRoot), DOC_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [open, hasPendingWiki, load, currentPath, zoneRoot]);

  const onEntryClick = (entry: WorkspaceEntry) => {
    if (entry.name === ".") {
      void load(currentPath);
      return;
    }
    if (entry.is_dir && isWithinZone(entry.path)) {
      void load(entry.path);
      return;
    }
    if (!entry.is_dir) {
      setPreview({
        type: "workspace",
        path: entry.path,
        filename: entry.name,
      });
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file || !canWrite) return;
    setBusy(true);
    setErrMsg(null);
    try {
      const res = await workspaceApi.upload(currentPath, file);
      setListing(res);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleMkdir = async () => {
    const name = newDirName.trim();
    if (!name || !canWrite) return;
    setBusy(true);
    setErrMsg(null);
    try {
      const target = joinWorkspacePath(currentPath, name);
      const res = await workspaceApi.mkdir(target);
      setListing(res);
      setMkdirOpen(false);
      setNewDirName("");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (entry: WorkspaceEntry) => {
    if (entry.readonly || entry.name === "." || entry.name === ".." || !canWrite) return;
    if (!window.confirm(`确认删除「${entry.display_name}」？`)) return;
    setBusy(true);
    setErrMsg(null);
    try {
      await workspaceApi.delete(entry.path);
      await load(currentPath);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (entry: WorkspaceEntry) => {
    if (entry.is_dir) return;
    setBusy(true);
    setErrMsg(null);
    try {
      await workspaceApi.download(entry.path, entry.name);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "下载失败");
    } finally {
      setBusy(false);
    }
  };

  const openWiki = (entry: WorkspaceEntry) => {
    if (!entry.doc_id || !entry.kb_id) return;
    setWikiDoc(
      knowledgeDocFromUpload({
        docId: entry.doc_id,
        kbId: entry.kb_id,
        name: entry.display_name || entry.name,
        fileSize: entry.size,
        status: (entry.knowledge_status as KnowledgeDocument["status"]) || "uploaded",
        wikiCompiled: entry.wiki_compiled,
      }),
    );
  };

  const workspaceRoot = sessionId ? sessionWorkspaceRoot(sessionId) : "";
  const entries = (listing?.entries ?? []).filter((entry) => {
    if (zone === SESSION_ZONE_SESSION_MEMORY && sessionId) {
      // pi 实际文件名是 {timestamp}_{sessionId}.jsonl，不是 {sessionId}.jsonl
      return isPiSessionFileForSession(entry.name, sessionId);
    }
    if (
      zone === SESSION_ZONE_ARTIFACTS &&
      workspaceRoot &&
      isHiddenInArtifactsZone(entry.name, currentPath, workspaceRoot)
    ) {
      return false;
    }
    if (entry.name === "..") return isWithinZone(entry.path);
    return true;
  });
  const relPath = zoneRoot ? relativeWithinZone(currentPath, zoneRoot) : "";
  const artifactsRel = artifactsDisplayRel(relPath);
  const pathLabel =
    zone === SESSION_ZONE_SESSION_MEMORY
      ? `${PI_SESSIONS_DIR}${relPath ? `/${relPath}` : ""}`
      : zone === SESSION_ZONE_ARTIFACTS
        ? `对话产物${artifactsRel ? `/${artifactsRel}` : ""}`
        : `${zone}${relPath ? `/${relPath}` : ""}`;

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-ink-900/20 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-white/95 backdrop-blur-xl border-l border-ink-200/80 shadow-panel flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-ink-100 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink-900">会话文件</h2>
              <p className="text-[11px] text-ink-400 mt-0.5 truncate font-mono">
                /{pathLabel}
              </p>
            </div>
            <button type="button" onClick={onClose} className="ui-icon-btn shrink-0" aria-label="关闭">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex gap-1 p-0.5 rounded-lg bg-ink-100/70">
            {SESSION_ZONES.map((item) => {
              const active = zone === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setZone(item.id)}
                  className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    active
                      ? "bg-white text-ink-900 shadow-sm"
                      : "text-ink-500 hover:text-ink-700"
                  }`}
                  title={item.hint}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
          {!sessionId ? (
            <ConfigEmptyState message="先发一条消息开启会话，再管理本会话的文件" />
          ) : (
            <ConfigPanelLayout
              loading={loading && !listing}
              loadingText="加载会话文件…"
              errMsg={errMsg}
              toolbar={(
                <div className="flex items-center justify-between gap-2 mb-2 min-h-[22px]">
                  <p className="text-[11px] text-ink-400 truncate">
                    {zoneMeta?.hint}
                  </p>
                  {canWrite && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        onChange={(e) => void handleUpload(e.target.files?.[0])}
                      />
                      <ConfigActionBtn disabled={busy} onClick={() => fileInputRef.current?.click()}>
                        上传
                      </ConfigActionBtn>
                      <ConfigActionBtn
                        disabled={busy}
                        onClick={() => {
                          setMkdirOpen((v) => !v);
                          setNewDirName("");
                        }}
                      >
                        新建
                      </ConfigActionBtn>
                    </div>
                  )}
                </div>
              )}
            >
              {mkdirOpen && canWrite && (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-ink-200 bg-ink-50/60 mb-3">
                  <input
                    className="flex-1 text-sm px-3 py-1.5 rounded-lg border border-ink-200 bg-white"
                    placeholder="文件夹名称"
                    value={newDirName}
                    onChange={(e) => setNewDirName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleMkdir();
                    }}
                  />
                  <ConfigPrimaryBtn disabled={busy || !newDirName.trim()} onClick={() => void handleMkdir()}>
                    创建
                  </ConfigPrimaryBtn>
                  <ConfigActionBtn onClick={() => setMkdirOpen(false)}>取消</ConfigActionBtn>
                </div>
              )}

              {entries.length === 0 ? (
                <ConfigEmptyState
                  message={
                    zone === SESSION_ZONE_UPLOADS
                      ? "暂无文件，点击「上传」添加"
                      : zone === SESSION_ZONE_SESSION_MEMORY
                        ? "暂无会话记忆，对话开始后由 pi 自动生成"
                        : "暂无文件"
                  }
                />
              ) : (
                <ul className="divide-y divide-ink-100 border border-ink-200/60 rounded-xl overflow-hidden">
                  {entries.map((entry) => {
                    const isNav = entry.name === "." || entry.name === "..";
                    const clickableDir = entry.is_dir && (!isNav || entry.name === "..");
                    const clickableFile = !entry.is_dir && !isNav;
                    const clickable = clickableDir || clickableFile;
                    const wikiReady = canOpenWikiGraph(entry.knowledge_status, entry.wiki_compiled);
                    const showGraphBtn = zone === SESSION_ZONE_UPLOADS && clickableFile;
                    const canOpenGraph = Boolean(entry.doc_id && entry.kb_id && wikiReady);
                    return (
                      <li
                        key={`${entry.path}:${entry.name}`}
                        className="flex items-center gap-2 px-3.5 py-2.5 hover:bg-ink-50/80 transition-colors"
                      >
                        <button
                          type="button"
                          disabled={entry.name === "." || !clickable}
                          onClick={() => onEntryClick(entry)}
                          className={`flex-1 min-w-0 text-left ${
                            clickable && entry.name !== "." ? "cursor-pointer" : "cursor-default"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-ink-400 text-xs w-9 shrink-0 font-mono">
                              {entry.is_dir ? "dir" : "file"}
                            </span>
                            <TruncatedFilename
                              name={entry.display_name}
                              className={`flex-1 text-sm ${
                                entry.is_dir && entry.name !== "."
                                  ? "text-brand-700 font-medium"
                                  : clickableFile
                                    ? "text-ink-800 hover:text-brand-700"
                                    : "text-ink-800"
                              }`}
                            />
                          </div>
                          {!isNav && (
                            <p className="text-xs text-ink-400 mt-0.5 pl-11 truncate">
                              {formatFileSize(entry.size, entry.is_dir)}
                              {entry.mtime ? ` · ${formatOptionalMtime(entry.mtime)}` : ""}
                            </p>
                          )}
                        </button>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {!entry.is_dir && !isNav && (
                            <>
                              {showGraphBtn && (
                                <ConfigActionBtn
                                  variant="violet"
                                  disabled={busy || !canOpenGraph}
                                  title={
                                    canOpenGraph
                                      ? "查看 Wiki 图谱"
                                      : "Wiki 解析中，完成后可查看图谱"
                                  }
                                  onClick={() => openWiki(entry)}
                                >
                                  图谱
                                </ConfigActionBtn>
                              )}
                              <ConfigActionBtn disabled={busy} onClick={() => void handleDownload(entry)}>
                                下载
                              </ConfigActionBtn>
                            </>
                          )}
                          {canWrite && !entry.readonly && !isNav && (
                            <ConfigActionBtn variant="danger" disabled={busy} onClick={() => void handleDelete(entry)}>
                              删除
                            </ConfigActionBtn>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ConfigPanelLayout>
          )}
        </div>
      </aside>

      {preview && (
        <FilePreviewModal
          source={preview}
          subtitle={preview.path}
          onClose={() => setPreview(null)}
        />
      )}
      {wikiDoc && (
        <DocumentWikiModal
          kbId={wikiDoc.kb_id}
          doc={wikiDoc}
          onClose={() => setWikiDoc(null)}
        />
      )}
    </>
  );
}
