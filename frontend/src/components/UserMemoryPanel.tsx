import { useCallback, useEffect, useState } from "react";
import { workspaceApi, type WorkspaceEntry } from "../api/workspace";
import { useChatSession } from "../context/ChatSessionContext";
import { formatFileSize, formatOptionalMtime } from "../utils/formatFileSize";
import { ConfigActionBtn } from "./config/ConfigActionBtn";
import { ModalOverlay } from "./config/ModalOverlay";
import FilePreviewModal, { type FilePreviewSource } from "./FilePreviewModal";

/** 用户级长期记忆目录（跨 session，相对用户根） */
const USER_MEMORY_DIR = "memory";

/**
 * 配置页「用户记忆」：浏览该用户跨会话的长期记忆（users/{uid}/memory/）。
 * 会话级 JSONL 在聊天侧栏「会话记忆」，不在这里。
 */
export default function UserMemoryPanel() {
  const { userId } = useChatSession();
  const uid = userId.trim();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState(USER_MEMORY_DIR);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);

  const loadList = useCallback(
    async (path: string) => {
      if (!uid) return;
      setLoading(true);
      setErrMsg(null);
      try {
        // 先 ls 用户根，确保 memory 在 ROOT_VISIBLE 中被 mkdir
        await workspaceApi.ls(uid, "");
        const listing = await workspaceApi.ls(uid, path);
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
    },
    [uid],
  );

  useEffect(() => {
    if (!open) return;
    void loadList(USER_MEMORY_DIR);
  }, [open, loadList]);

  const onEntryClick = (entry: WorkspaceEntry) => {
    if (entry.is_dir) {
      void loadList(entry.path);
      return;
    }
    setPreview({
      type: "workspace",
      userId: uid,
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
      <ConfigActionBtn
        disabled={!uid}
        title={uid ? `查看 ${USER_MEMORY_DIR}/（用户级长期记忆）` : "请先设置用户 ID"}
        onClick={() => setOpen(true)}
      >
        用户记忆
      </ConfigActionBtn>

      {open && (
        <ModalOverlay onBackdropClick={() => setOpen(false)}>
          <div
            className="bg-white rounded-2xl shadow-panel border border-ink-100 w-full max-w-2xl h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-5 py-4 border-b border-ink-100 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-ink-900">用户记忆</h2>
                <p className="text-[11px] text-ink-400 mt-0.5 font-mono truncate">
                  /{currentPath || USER_MEMORY_DIR}（跨会话长期记忆）
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {canGoUp && (
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
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="ui-icon-btn"
                  aria-label="关闭"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
              {loading && <p className="text-sm text-ink-400">加载中…</p>}
              {!loading && errMsg && <p className="text-sm text-rose-600">{errMsg}</p>}
              {!loading && !errMsg && entries.length === 0 && (
                <p className="text-sm text-ink-400">
                  暂无用户记忆。会话级对话历史请在聊天侧栏「会话记忆」查看。
                </p>
              )}
              {!loading && !errMsg && entries.length > 0 && (
                <ul className="space-y-1">
                  {entries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-ink-50 transition-colors"
                        onClick={() => onEntryClick(entry)}
                      >
                        <div className="text-sm text-ink-800 font-mono truncate">
                          {entry.is_dir ? `${entry.name}/` : entry.name}
                        </div>
                        <div className="text-[11px] text-ink-400 mt-0.5">
                          {[
                            entry.is_dir ? "目录" : formatFileSize(entry.size),
                            formatOptionalMtime(entry.mtime),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}

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
