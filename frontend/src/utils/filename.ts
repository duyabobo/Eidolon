/** 拆分文件名主干与后缀（含点）；无后缀时 ext 为空 */
export function splitFilename(name: string): { stem: string; ext: string } {
  const base = name.trim();
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === base.length - 1) {
    return { stem: base, ext: "" };
  }
  return { stem: base.slice(0, lastDot), ext: base.slice(lastDot) };
}
