import { useEffect, useMemo, useState } from "react";
import { skillCreatorApi } from "../api/skillCreator";
import { skillsApi } from "../api/skills";
import { workspaceApi } from "../api/workspace";
import { detectFilePreviewKind, type FilePreviewKind } from "../utils/filePreview";
import { formatFileSize } from "../utils/formatFileSize";
import ChatMarkdown from "./chat/ChatMarkdown";
import { ModalOverlay } from "./config/ModalOverlay";

export type FilePreviewSource =
  | { type: "workspace"; userId: string; path: string; filename: string }
  | { type: "skill"; skillName: string; path: string; filename: string; userId?: string }
  | { type: "skill-creator"; sessionId: string; path: string; filename: string };

interface Props {
  source: FilePreviewSource;
  subtitle?: string;
  onClose: () => void;
}

function sourceKey(source: FilePreviewSource): string {
  if (source.type === "workspace") {
    return `ws:${source.userId}:${source.path}`;
  }
  if (source.type === "skill-creator") {
    return `sc:${source.sessionId}:${source.path}`;
  }
  return `sk:${source.userId ?? ""}:${source.skillName}:${source.path}`;
}

export default function FilePreviewModal({ source, subtitle, onClose }: Props) {
  const kind: FilePreviewKind = detectFilePreviewKind(source.filename);
  const key = sourceKey(source);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [blobSize, setBlobSize] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  const loaders = useMemo(() => {
    if (source.type === "workspace") {
      const { userId, path, filename } = source;
      return {
        loadText: () => workspaceApi.fetchText(userId, path),
        loadBlob: () => workspaceApi.fetchBlob(userId, path, "inline"),
        download: () => workspaceApi.download(userId, path, filename),
      };
    }
    if (source.type === "skill-creator") {
      const { sessionId, path, filename } = source;
      return {
        loadText: () => skillCreatorApi.fetchFileText(sessionId, path),
        loadBlob: () => skillCreatorApi.fetchFileBlob(sessionId, path),
        download: () => skillCreatorApi.downloadFile(sessionId, path, filename),
      };
    }
    const { skillName, path, filename, userId } = source;
    return {
      loadText: () => skillsApi.fetchFileText(skillName, path, userId),
      loadBlob: () => skillsApi.fetchFileBlob(skillName, path, userId),
      download: () => skillsApi.downloadFile(skillName, path, filename, userId),
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed by sourceKey

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      setText(null);
      setObjectUrl(null);
      setBlobSize(null);
      try {
        if (kind === "markdown" || kind === "text") {
          const body = await loaders.loadText();
          if (!cancelled) setText(body);
        } else if (kind === "image" || kind === "pdf") {
          const blob = await loaders.loadBlob();
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          revoked = url;
          setObjectUrl(url);
          setBlobSize(blob.size);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "预览失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (kind === "unsupported") {
      setLoading(false);
      setError(null);
      setText(null);
      setObjectUrl(null);
      return;
    }

    void run();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [key, kind, loaders]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await loaders.download();
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <ModalOverlay zClass="z-[60]" onBackdropClick={onClose}>
      {/* 与经验 SkillCreator 一致：max-w-4xl + h-[90vh]，正文区内滚动 */}
      <div
        className="bg-white rounded-2xl shadow-panel w-full max-w-4xl h-[90vh] border border-ink-200/60 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={source.filename}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-ink-200/60 shrink-0">
          <div className="min-w-0">
            <h2 className="font-semibold text-ink-900 truncate">{source.filename}</h2>
            <p className="text-[11px] text-ink-400 mt-0.5 truncate">
              {[subtitle, blobSize != null ? formatFileSize(blobSize) : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={downloading}
              onClick={() => void handleDownload()}
              className="text-xs px-2.5 py-1.5 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50 disabled:opacity-50"
            >
              {downloading ? "下载中…" : "下载"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-2.5 py-1.5 border border-ink-200 rounded-lg text-ink-500 hover:bg-ink-50"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="px-5 py-4 overflow-y-auto overscroll-contain scrollbar-thin flex-1 min-h-0 flex flex-col">
          {loading && <p className="text-sm text-ink-400 animate-pulse">加载预览…</p>}
          {error && (
            <p className="text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700">{error}</p>
          )}
          {!loading && !error && kind === "markdown" && text != null && (
            <div className="text-sm leading-relaxed text-ink-900">
              <ChatMarkdown content={text} />
            </div>
          )}
          {!loading && !error && kind === "text" && text != null && (
            <pre className="text-xs text-ink-800 bg-ink-50 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed border border-ink-200/60 font-mono">
              {text}
            </pre>
          )}
          {!loading && !error && kind === "image" && objectUrl && (
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <img
                src={objectUrl}
                alt={source.filename}
                className="max-w-full max-h-full object-contain rounded-lg border border-ink-100"
              />
            </div>
          )}
          {!loading && !error && kind === "pdf" && objectUrl && (
            <iframe
              title={source.filename}
              src={objectUrl}
              className="w-full flex-1 min-h-0 rounded-lg border border-ink-200"
            />
          )}
          {!loading && kind === "unsupported" && (
            <div className="text-sm text-ink-600 space-y-3">
              <p>该文件类型暂不支持在线预览，请下载后查看。</p>
              <button
                type="button"
                disabled={downloading}
                onClick={() => void handleDownload()}
                className="text-xs px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {downloading ? "下载中…" : "下载文件"}
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}
