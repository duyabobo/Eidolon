import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceApi, type WorkspaceEntry, type WorkspaceListResponse } from "../../api/workspace";
import { canPreviewFile } from "../../utils/filePreview";
import FilePreviewModal, { type FilePreviewSource } from "../FilePreviewModal";
import { ConfigActionBtn, ConfigPrimaryBtn, ConfigToolbarBtn } from "../config/ConfigActionBtn";
import { ConfigEmptyState, ConfigListToolbar, ConfigPanelLayout } from "../config/ConfigPanelLayout";

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  sessionId: string | null;
}

function formatSize(bytes: number, isDir: boolean): string {
  if (isDir) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMtime(mtime: string | null): string {
  if (!mtime) return "";
  try {
    return new Date(mtime).toLocaleString();
  } catch {
    return "";
  }
}

function joinPath(parent: string, name: string): string {
  if (!parent) return name;
  return `${parent}/${name}`;
}

/**
 * 会话级文件系统：每个会话（session）都有一个独立可读写的 workspace 子目录
 * （sessions/{sessionId}/workspace，见 pi_shared.workspace.fs.session_workspace_rel_parts）。
 * 这里只在这一棵子树内浏览/上传/删除，navigateTo 会拦截越界到 basePath 之外的路径
 * （比如点击工作区根目录的 ".." 不应该看到会话自己的 home/tmp 等沙盒运行态目录）。
 */
export default function SessionFilesDrawer({ open, onClose, userId, sessionId }: Props) {
  const [currentPath, setCurrentPath] = useState("");
  const [listing, setListing] = useState<WorkspaceListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uid = userId.trim();
  const basePath = sessionId ? `sessions/${sessionId}/workspace` : null;

  const isWithinScope = useCallback(
    (path: string) => !!basePath && (path === basePath || path.startsWith(`${basePath}/`)),
    [basePath],
  );

  const load = useCallback(
    async (path: string) => {
      if (!uid || !basePath) return;
      setLoading(true);
      setErrMsg(null);
      try {
        const res = await workspaceApi.ls(uid, path);
        setListing(res);
        setCurrentPath(res.path);
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    },
    [uid, basePath],
  );

  useEffect(() => {
    if (open && basePath) void load(basePath);
  }, [open, basePath, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onEntryClick = (entry: WorkspaceEntry) => {
    if (entry.name === ".") {
      void load(currentPath);
      return;
    }
    if (entry.is_dir && isWithinScope(entry.path)) {
      void load(entry.path);
      return;
    }
    if (!entry.is_dir) {
      setPreview({
        type: "workspace",
        userId: uid,
        path: entry.path,
        filename: entry.name,
      });
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErrMsg(null);
    try {
      const res = await workspaceApi.upload(uid, currentPath, file);
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
    if (!name) return;
    setBusy(true);
    setErrMsg(null);
    try {
      const target = joinPath(currentPath, name);
      const res = await workspaceApi.mkdir(uid, target);
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
    if (entry.readonly || entry.name === "." || entry.name === "..") return;
    if (!window.confirm(`确认删除「${entry.display_name}」？`)) return;
    setBusy(true);
    setErrMsg(null);
    try {
      await workspaceApi.delete(uid, entry.path);
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
      await workspaceApi.download(uid, entry.path, entry.name);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "下载失败");
    } finally {
      setBusy(false);
    }
  };

  const entries = (listing?.entries ?? []).filter((entry) => {
    if (entry.name === "..") return isWithinScope(entry.path);
    return true;
  });
  const relPath = basePath && currentPath.startsWith(basePath)
    ? currentPath.slice(basePath.length).replace(/^\//, "")
    : "";

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
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink-900">会话文件</h2>
            <p className="text-[11px] text-ink-400 mt-0.5 truncate font-mono">
              {relPath ? `/ ${relPath}` : "/"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="ui-icon-btn shrink-0" aria-label="关闭">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
          {!uid || !sessionId ? (
            <ConfigEmptyState message="先发一条消息开启会话，再管理本会话的文件" />
          ) : (
            <ConfigPanelLayout
              loading={loading && !listing}
              loadingText="加载会话文件…"
              errMsg={errMsg}
              toolbar={(
                <ConfigListToolbar
                  right={(
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        onChange={(e) => void handleUpload(e.target.files?.[0])}
                      />
                      <ConfigToolbarBtn disabled={busy} onClick={() => fileInputRef.current?.click()}>
                        上传
                      </ConfigToolbarBtn>
                      <ConfigToolbarBtn
                        disabled={busy}
                        onClick={() => {
                          setMkdirOpen((v) => !v);
                          setNewDirName("");
                        }}
                      >
                        新建文件夹
                      </ConfigToolbarBtn>
                    </>
                  )}
                />
              )}
            >
              {mkdirOpen && (
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
                <ConfigEmptyState message="暂无文件，点击「上传」添加" />
              ) : (
                <ul className="divide-y divide-ink-100 border border-ink-200/60 rounded-xl overflow-hidden">
                  {entries.map((entry) => {
                    const isNav = entry.name === "." || entry.name === "..";
                    const clickableDir = entry.is_dir && (!isNav || entry.name === "..");
                    const clickableFile = !entry.is_dir && !isNav;
                    const clickable = clickableDir || clickableFile;
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
                            <span
                              className={`truncate text-sm ${
                                entry.is_dir && entry.name !== "."
                                  ? "text-brand-700 font-medium"
                                  : clickableFile
                                    ? "text-ink-800 hover:text-brand-700"
                                    : "text-ink-800"
                              }`}
                            >
                              {entry.display_name}
                            </span>
                          </div>
                          {!isNav && (
                            <p className="text-xs text-ink-400 mt-0.5 pl-11">
                              {formatSize(entry.size, entry.is_dir)}
                              {entry.mtime ? ` · ${formatMtime(entry.mtime)}` : ""}
                              {clickableFile && canPreviewFile(entry.name) ? " · 点击预览" : ""}
                            </p>
                          )}
                        </button>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {!entry.is_dir && !isNav && (
                            <>
                              <ConfigActionBtn
                                disabled={busy}
                                onClick={() =>
                                  setPreview({
                                    type: "workspace",
                                    userId: uid,
                                    path: entry.path,
                                    filename: entry.name,
                                  })
                                }
                              >
                                预览
                              </ConfigActionBtn>
                              <ConfigActionBtn disabled={busy} onClick={() => void handleDownload(entry)}>
                                下载
                              </ConfigActionBtn>
                            </>
                          )}
                          {!entry.readonly && !isNav && (
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
    </>
  );
}
