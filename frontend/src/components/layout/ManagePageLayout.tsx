import type { ReactNode } from "react";

interface ManagePageLayoutProps {
  title: string;
  children: ReactNode;
}

export default function ManagePageLayout({ title, children }: ManagePageLayoutProps) {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin bg-[var(--app-surface)]">
      <div className="page-content py-8">
        <h1 className="text-xl font-semibold text-ink-900 mb-6 tracking-tight">{title}</h1>
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-ink-200/50 shadow-soft p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
