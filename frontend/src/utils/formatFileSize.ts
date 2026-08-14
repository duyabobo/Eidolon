const KB = 1024;
const MB = KB * 1024;

/** 文件大小展示；目录返回 em dash；无效值返回空串。 */
export function formatFileSize(bytes?: number | null, isDir = false): string {
  if (isDir) return "—";
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

export function formatOptionalMtime(mtime: string | null): string {
  if (!mtime) return "";
  try {
    return new Date(mtime).toLocaleString();
  } catch {
    return "";
  }
}
