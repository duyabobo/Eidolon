import type { ReactNode } from "react";
import { ConfigToolbarBtn } from "./ConfigActionBtn";

interface Props {
  loading?: boolean;
  loadingText?: string;
  errMsg?: string | null;
  toolbar?: ReactNode;
  pagination?: ReactNode;
  children: ReactNode;
}

export function ConfigPanelLayout({
  loading,
  loadingText = "加载中…",
  errMsg,
  toolbar,
  pagination,
  children,
}: Props) {
  if (loading) {
    return <p className="text-sm text-ink-400 py-6">{loadingText}</p>;
  }

  return (
    <div className="space-y-4">
      {toolbar}
      {errMsg && (
        <p className="text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700">
          {errMsg}
        </p>
      )}
      {children}
      {pagination}
    </div>
  );
}

export function ConfigListToolbar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2 min-w-0 flex-1">{left}</div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">{right}</div>
    </div>
  );
}

export function ConfigEmptyState({ message }: { message: string }) {
  return (
    <p className="text-sm text-ink-400 text-center py-10 border border-dashed border-ink-200 rounded-xl">
      {message}
    </p>
  );
}

export function ConfigListPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <p className="text-xs text-ink-400">
        共 {total} 条 · 第 {page}/{totalPages} 页
      </p>
      <div className="flex gap-2">
        <ConfigToolbarBtn disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          上一页
        </ConfigToolbarBtn>
        <ConfigToolbarBtn disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          下一页
        </ConfigToolbarBtn>
      </div>
    </div>
  );
}
