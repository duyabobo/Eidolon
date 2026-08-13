import { useEffect, useMemo, useState } from "react";
import type { SkillTreeEntry } from "../api/skills";
import { canPreviewFile } from "../utils/filePreview";

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  children: TreeNode[];
}

function buildTree(entries: SkillTreeEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  const ensureDir = (dirPath: string): TreeNode[] => {
    if (!dirPath) return root;
    const existing = dirMap.get(dirPath);
    if (existing) return existing.children;
    const parts = dirPath.split("/");
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join("/");
    const parentChildren = ensureDir(parentPath);
    const node: TreeNode = { name, path: dirPath, isDir: true, size: 0, children: [] };
    dirMap.set(dirPath, node);
    parentChildren.push(node);
    return node.children;
  };

  for (const entry of entries) {
    if (entry.is_dir) {
      ensureDir(entry.path);
      continue;
    }
    const parts = entry.path.split("/");
    const parentPath = parts.slice(0, -1).join("/");
    const siblings = ensureDir(parentPath);
    siblings.push({
      name: entry.name,
      path: entry.path,
      isDir: false,
      size: entry.size,
      children: [],
    });
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => {
      if (n.children.length) sortNodes(n.children);
    });
  };
  sortNodes(root);
  return root;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  /** 拉取目录树；返回 entries */
  loadEntries: () => Promise<SkillTreeEntry[]>;
  /** 变化时重新加载（如 draft 更新、上传后） */
  refreshKey?: string | number;
  onPreview: (path: string, filename: string) => void;
  emptyText?: string;
  className?: string;
  maxHeightClass?: string;
}

export default function SkillFolderTree({
  loadEntries,
  refreshKey = "",
  onPreview,
  emptyText = "目录为空",
  className = "rounded-lg border border-ink-200/60 bg-ink-50/50 p-2",
  maxHeightClass = "max-h-72",
}: Props) {
  const [entries, setEntries] = useState<SkillTreeEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setErr(null);
    loadEntries()
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
        const topDirs = list.filter((e) => e.is_dir && !e.path.includes("/")).map((e) => e.path);
        setExpanded(new Set(topDirs));
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [loadEntries, refreshKey]);

  const tree = useMemo(() => (entries ? buildTree(entries) : []), [entries]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNodes = (nodes: TreeNode[], depth: number) => (
    <ul className={depth === 0 ? "space-y-0.5" : "mt-0.5 space-y-0.5"}>
      {nodes.map((node) => {
        const pad = { paddingLeft: `${depth * 14 + 4}px` };
        if (node.isDir) {
          const open = expanded.has(node.path);
          return (
            <li key={node.path}>
              <button
                type="button"
                style={pad}
                onClick={() => toggle(node.path)}
                className="w-full text-left text-xs py-1 pr-2 rounded hover:bg-ink-100/80 text-ink-700 font-medium flex items-center gap-1.5"
              >
                <span className="text-ink-400 w-3 shrink-0 font-mono">{open ? "▾" : "▸"}</span>
                <span className="truncate">{node.name}/</span>
              </button>
              {open && renderNodes(node.children, depth + 1)}
            </li>
          );
        }
        const previewable = canPreviewFile(node.name);
        return (
          <li key={node.path}>
            <button
              type="button"
              style={pad}
              onClick={() => onPreview(node.path, node.name)}
              className="w-full text-left text-xs py-1 pr-2 rounded hover:bg-brand-50/60 text-ink-700 flex items-center gap-1.5"
              title={previewable ? "预览" : "打开 / 下载"}
            >
              <span className="text-ink-300 w-3 shrink-0 font-mono">·</span>
              <span className="truncate flex-1 min-w-0">{node.name}</span>
              <span className="text-[10px] text-ink-400 shrink-0">{formatSize(node.size)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  if (err) return <p className="text-xs text-red-400 mt-2">{err}</p>;
  if (entries === null) return <p className="text-xs text-ink-400 mt-2 animate-pulse">加载目录…</p>;
  if (tree.length === 0) return <p className="text-xs text-ink-400 mt-2">{emptyText}</p>;

  return (
    <div className={`${className} ${maxHeightClass} overflow-auto`}>
      {renderNodes(tree, 0)}
    </div>
  );
}
