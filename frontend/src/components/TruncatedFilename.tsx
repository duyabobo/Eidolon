import { splitFilename } from "../utils/filename";

interface Props {
  name: string;
  className?: string;
}

/**
 * 单行文件名：过长时省略主干，始终保留后缀（如 .pdf）。
 */
export default function TruncatedFilename({ name, className = "" }: Props) {
  const { stem, ext } = splitFilename(name);

  if (!ext) {
    return (
      <span className={`block truncate min-w-0 ${className}`.trim()} title={name}>
        {name}
      </span>
    );
  }

  return (
    <span className={`flex min-w-0 max-w-full ${className}`.trim()} title={name}>
      <span className="truncate min-w-0">{stem}</span>
      <span className="shrink-0">{ext}</span>
    </span>
  );
}
