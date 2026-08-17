import { useCallback, useEffect, useState } from "react";
import { workspaceApi, type WorkspaceEntry } from "../api/workspace";
import { formatFileSize, formatOptionalMtime } from "../utils/formatFileSize";
import { ConfigActionBtn } from "./config/ConfigActionBtn";
import { ConfigEmptyState, ConfigPanelLayout } from "./config/ConfigPanelLayout";
import FilePreviewModal, { type FilePreviewSource } from "./FilePreviewModal";

/** 用户级长期记忆目录（跨 session，相对用户根） */
const USER_MEMORY_DIR = "memory";

/**
 * 配置页「用户记忆」：直接展示本机跨会话长期记忆文件列表，点击可预览。
 * 会话级 JSONL 在聊天侧栏「会话记忆」，不在这里。
 */
export default function UserMemoryPanel() {
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState(USER_MEMORY_DIR);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);

  const loadList = useCallback(async (path: string) => {
    setLoading(true);
    setErrMsg(null);
    try {
      // 先 ls 本机根，确保 memory 在 ROOT_VISIBLE 中被 mkdir
      await workspaceApi.ls("");
      const listing = await workspaceApi.ls(path);
      setCurrentPath(listing.path || USER_MEMORY_DIR);
      setEntries(
        listing.entries.filter((e) => e.name !== "." && e.name !== ".."),
      );
    } catch (e) {
      setEntries([]);
      setErrMsg(e instanceof Error ? e.message : "加载用户记忆失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList(USER_MEMORY_DIR);
  }, [loadList]);

  const onEntryClick = (entry: WorkspaceEntry) => {
    if (entry.is_dir) {
      void loadList(entry.path);
      return;
    }
    setPreview({
      type: "workspace",
      path: entry.path,
      filename: entry.name,
    });
  };

  const canGoUp =
    currentPath === USER_MEMORY_DIR
      ? false
      : currentPath.startsWith(`${USER_MEMORY_DIR}/`);

  return (
    <>
      <ConfigPanelLayout
        loading={loading}
        loadingText="加载用户记忆…"
        errMsg={errMsg}
        toolbar={canGoUp ? (
          <div className="flex items-center justify-end">
            <ConfigActionBtn
              disabled={loading}
              onClick={() => {
                const parent = currentPath.includes("/")
                  ? currentPath.slice(0, currentPath.lastIndexOf("/"))
                  : USER_MEMORY_DIR;
                void loadList(parent || USER_MEMORY_DIR);
              }}
            >
              上级
            </ConfigActionBtn>
          </div>
        ) : undefined}
      >
        {entries.length === 0 ? (
          <ConfigEmptyState message="暂无用户记忆。会话级对话历史请在聊天侧栏「会话记忆」查看。" />
        ) : (
          <ul className="divide-y divide-ink-100 border border-ink-200/60 rounded-xl overflow-hidden">
            {entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="w-full text-left px-3.5 py-2.5 hover:bg-ink-50/80 transition-colors"
                  onClick={() => onEntryClick(entry)}
                  title={entry.is_dir ? "打开目录" : "预览"}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-ink-400 w-5 shrink-0 font-mono text-xs">
                      {entry.is_dir ? "▸" : "·"}
                    </span>
                    <span className="flex-1 min-w-0 text-sm text-ink-800 font-mono truncate">
                      {entry.is_dir ? `${entry.name}/` : entry.name}
                    </span>
                    <span className="text-[11px] text-ink-400 shrink-0">
                      {[
                        entry.is_dir ? "目录" : formatFileSize(entry.size),
                        formatOptionalMtime(entry.mtime),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ConfigPanelLayout>

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
