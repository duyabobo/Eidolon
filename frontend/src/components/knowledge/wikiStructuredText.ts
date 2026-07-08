const STRUCTURED_FIELD_BREAK_LABELS = ["OCR内容", "文件地址"] as const;

const FILE_URL_PATTERN = /文件地址[：:]\s*(https?:\/\/\S+)/g;

function trimTrailingUrlPunctuation(url: string): string {
  return url.replace(/[.,;，。；)\]）]+$/u, "");
}

/** 将「描述 / OCR内容 / 文件地址」分段换行，并把文件地址转为 Markdown 超链接 */
export function preprocessStructuredFields(content: string): string {
  let text = content;

  for (const label of STRUCTURED_FIELD_BREAK_LABELS) {
    const pattern = new RegExp(`([^\\n])\\s*(${label}[：:])`, "gu");
    text = text.replace(pattern, "$1\n\n$2");
  }

  text = text.replace(FILE_URL_PATTERN, (_, rawUrl: string) => {
    const url = trimTrailingUrlPunctuation(rawUrl.trim());
    return `文件地址：[${url}](${url})`;
  });

  return text;
}
