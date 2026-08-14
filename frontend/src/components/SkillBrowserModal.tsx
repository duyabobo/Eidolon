import { useEffect, useMemo, useRef, useState } from "react";
import { skillsApi, type SkillTreeEntry } from "../api/skills";
import { canPreviewFile } from "../utils/filePreview";
import { formatFileSize } from "../utils/formatFileSize";
import { ConfigActionBtn } from "./config/ConfigActionBtn";
import { ModalOverlay } from "./config/ModalOverlay";
import FilePreviewModal, { type FilePreviewSource } from "./FilePreviewModal";

interface Props {
  skillName: string;
  userId?: string;
  onClose: () => void;
}

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

function parentDir(path: string): string {
  if (!path.includes("/")) return "";
  return path.slice(0, path.lastIndexOf("/"));
}

/** 从扁平 tree 条目中取出某一层目录的直接子项 */
function listChildren(entries: SkillTreeEntry[], dir: string): DirEntry[] {
  const prefix = dir ? `${dir}/` : "";
  const seen = new Set<string>();
  const out: DirEntry[] = [];

  for (const entry of entries) {
    if (dir) {
      if (entry.path === dir) continue;
      if (!entry.path.startsWith(prefix)) continue;
    }

    const rest = dir ? entry.path.slice(prefix.length) : entry.path;
    if (!rest) continue;

    const slash = rest.indexOf("/");
    if (slash === -1) {
      if (seen.has(rest)) continue;
      seen.add(rest);
      out.push({
        name: rest,
        path: entry.path,
        isDir: entry.is_dir,
        size: entry.size,
      });
      continue;
    }

    const childName = rest.slice(0, slash);
    if (seen.has(childName)) continue;
    seen.add(childName);
    out.push({
      name: childName,
      path: dir ? `${dir}/${childName}` : childName,
      isDir: true,
      size: 0,
    });
  }

  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * Skill 目录浏览弹框：进入子目录、预览/下载文件。
 */
export default function SkillBrowserModal({ skillName, userId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [entries, setEntries] = useState<SkillTreeEntry[]>([]);
  const [currentDir, setCurrentDir] = useState("");
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const previewOpenRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrMsg(null);
    skillsApi
      .getTree(skillName, userId)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
      })
      .catch((e) => {
        if (!cancelled) setErrMsg(e instanceof Error ? e.message : "加载目录失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skillName, userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 预览弹层打开时由 FilePreviewModal 处理 Esc，避免连带关掉目录弹框
      if (e.key === "Escape" && !previewOpenRef.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const children = useMemo(() => listChildren(entries, currentDir), [entries, currentDir]);
  const pathLabel = currentDir ? `${skillName}/${currentDir}` : skillName;

  const onEntryClick = (entry: DirEntry) => {
    if (entry.isDir) {
      setCurrentDir(entry.path);
      return;
    }
    previewOpenRef.current = true;
    setPreview({
      type: "skill",
      skillName,
      path: entry.path,
      filename: entry.name,
      userId,
    });
  };

  return (
    <>
      <ModalOverlay onBackdropClick={onClose}>
        <div
          className="bg-white rounded-2xl shadow-panel border border-ink-100 w-full max-w-2xl h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 px-5 py-4 border-b border-ink-100 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink-900">查看 Skill</h2>
              <p className="text-[11px] text-ink-400 mt-0.5 font-mono truncate">/{pathLabel}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {currentDir !== "" && (
                <ConfigActionBtn
                  disabled={loading}
                  onClick={() => setCurrentDir(parentDir(currentDir))}
                >
                  上级
                </ConfigActionBtn>
              )}
              <button type="button" onClick={onClose} className="ui-icon-btn" aria-label="关闭">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
            {loading && <p className="text-sm text-ink-400">加载目录…</p>}
            {!loading && errMsg && <p className="text-sm text-rose-600">{errMsg}</p>}
            {!loading && !errMsg && children.length === 0 && (
              <p className="text-sm text-ink-400">目录为空</p>
            )}
            {!loading && !errMsg && children.length > 0 && (
              <ul className="divide-y divide-ink-100 border border-ink-200/60 rounded-xl overflow-hidden">
                {children.map((entry) => {
                  const previewable = !entry.isDir && canPreviewFile(entry.name);
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className="w-full text-left px-3.5 py-2.5 hover:bg-ink-50/80 transition-colors flex items-center gap-2"
                        onClick={() => onEntryClick(entry)}
                        title={
                          entry.isDir ? "打开目录" : previewable ? "预览" : "打开 / 下载"
                        }
                      >
                        <span className="text-ink-400 w-5 shrink-0 font-mono text-xs">
                          {entry.isDir ? "▸" : "·"}
                        </span>
                        <span className="flex-1 min-w-0 text-sm text-ink-800 font-mono truncate">
                          {entry.isDir ? `${entry.name}/` : entry.name}
                        </span>
                        <span className="text-[11px] text-ink-400 shrink-0">
                          {entry.isDir ? "目录" : formatFileSize(entry.size)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </ModalOverlay>

      {preview && (
        <FilePreviewModal
          source={preview}
          subtitle={`skill: ${skillName}`}
          onClose={() => {
            previewOpenRef.current = false;
            setPreview(null);
          }}
        />
      )}
    </>
  );
}
