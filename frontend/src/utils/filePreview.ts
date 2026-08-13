/** 根据文件名推断预览类型 */

export type FilePreviewKind = "markdown" | "text" | "image" | "pdf" | "unsupported";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);
const MARKDOWN_EXT = new Set(["md", "markdown", "mdx"]);
const PDF_EXT = new Set(["pdf"]);
const TEXT_EXT = new Set([
  "txt", "text", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "xml", "html", "htm", "css", "scss", "less",
  "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "py", "pyi", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cc", "cs",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  "sql", "r", "lua", "php", "pl", "pm", "dockerfile", "makefile", "cmake",
  "env", "gitignore", "dockerignore", "editorconfig", "lock",
]);

function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() || filename;
  const lower = base.toLowerCase();
  if (lower === "dockerfile" || lower === "makefile") return lower;
  const i = lower.lastIndexOf(".");
  if (i <= 0) return "";
  return lower.slice(i + 1);
}

export function detectFilePreviewKind(filename: string): FilePreviewKind {
  const ext = extensionOf(filename);
  if (!ext) return "unsupported";
  if (MARKDOWN_EXT.has(ext)) return "markdown";
  if (IMAGE_EXT.has(ext)) return "image";
  if (PDF_EXT.has(ext)) return "pdf";
  if (TEXT_EXT.has(ext)) return "text";
  return "unsupported";
}

export function canPreviewFile(filename: string): boolean {
  return detectFilePreviewKind(filename) !== "unsupported";
}
