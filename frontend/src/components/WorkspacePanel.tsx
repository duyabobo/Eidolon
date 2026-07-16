import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceApi, type WorkspaceEntry, type WorkspaceListResponse } from "../api/workspace";
import { ConfigActionBtn, ConfigPrimaryBtn, ConfigToolbarBtn } from "./config/ConfigActionBtn";
import {
  ConfigEmptyState,
  ConfigListToolbar,
  ConfigPanelLayout,
} from "./config/ConfigPanelLayout";

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

interface Props {
  userId: string;
}

export default function WorkspacePanel({ userId }: Props) {
  const [currentPath, setCurrentPath] = useState("");
  const [listing, setListing] = useState<WorkspaceListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uid = userId.trim();

  const load = useCallback(
    async (path: string) => {
      if (!uid) {
        setListing(null);
        setErrMsg("请先在右上角「历史」中设置用户 ID");
        return;
      }
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
    [uid],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  const navigateTo = (path: string) => {
    void load(path);
  };

  const onEntryClick = (entry: WorkspaceEntry) => {
    if (entry.name === ".") {
      void load(currentPath);
      return;
    }
    if (entry.is_dir) {
      navigateTo(entry.path);
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file || !listing?.writable) return;
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
    if (!name || !listing?.writable) return;
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

  if (!uid) {
    return (
      <ConfigEmptyState message="请先在右上角「历史」中设置用户 ID，再查看工作区文件" />
    );
  }

  const writable = listing?.writable ?? false;
  const entries = listing?.entries ?? [];

  return (
    <ConfigPanelLayout
      loading={loading && !listing}
      errMsg={errMsg}
      toolbar={
        <ConfigListToolbar
          left={
            <p className="text-sm text-ink-500 truncate">
              <span className="text-ink-400">路径</span>{" "}
              <span className="font-mono text-ink-700">{currentPath || "/"}</span>
              {writable ? (
                <span className="ml-2 text-xs text-emerald-600">可读写</span>
              ) : (
                <span className="ml-2 text-xs text-ink-400">只读</span>
              )}
            </p>
          }
          right={
            writable ? (
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
                <ConfigToolbarBtn disabled={busy || loading} onClick={() => void load(currentPath)}>
                  刷新
                </ConfigToolbarBtn>
              </>
            ) : (
              <ConfigToolbarBtn disabled={busy || loading} onClick={() => void load(currentPath)}>
                刷新
              </ConfigToolbarBtn>
            )
          }
        />
      }
    >
      {mkdirOpen && writable && (
        <div className="flex items-center gap-2 p-3 rounded-xl border border-ink-200 bg-ink-50/60">
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
        <ConfigEmptyState message="目录为空" />
      ) : (
        <ul className="divide-y divide-ink-100 border border-ink-200/60 rounded-xl overflow-hidden">
          {entries.map((entry) => {
            const isNav = entry.name === "." || entry.name === "..";
            const clickable = entry.is_dir;
            return (
              <li
                key={`${entry.path}:${entry.name}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-50/80 transition-colors"
              >
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => onEntryClick(entry)}
                  className={`flex-1 min-w-0 text-left ${
                    clickable ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-ink-400 text-xs w-10 shrink-0 font-mono">
                      {entry.is_dir ? "dir" : "file"}
                    </span>
                    <span
                      className={`truncate text-sm ${
                        clickable ? "text-brand-700 font-medium" : "text-ink-800"
                      }`}
                    >
                      {entry.display_name}
                    </span>
                    {entry.readonly && !isNav && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-100 text-ink-400 shrink-0">
                        只读
                      </span>
                    )}
                  </div>
                  {!isNav && (
                    <p className="text-xs text-ink-400 mt-0.5 pl-10">
                      {formatSize(entry.size, entry.is_dir)}
                      {entry.mtime ? ` · ${formatMtime(entry.mtime)}` : ""}
                    </p>
                  )}
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!entry.is_dir && !isNav && (
                    <ConfigActionBtn
                      disabled={busy}
                      onClick={() => void handleDownload(entry)}
                    >
                      下载
                    </ConfigActionBtn>
                  )}
                  {writable && !entry.readonly && !isNav && (
                    <ConfigActionBtn
                      variant="danger"
                      disabled={busy}
                      onClick={() => void handleDelete(entry)}
                    >
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
  );
}
