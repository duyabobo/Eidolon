import type { ReactNode } from "react";

interface Props {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  extra?: ReactNode;
  actions?: ReactNode;
}

export function ConfigListItem({
  leading,
  title,
  subtitle,
  meta,
  extra,
  actions,
}: Props) {
  const cls = "flex items-start gap-3 border border-ink-200/60 rounded-xl px-4 py-3 bg-white";

  return (
    <div className={cls}>
      {leading}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {typeof title === "string" ? (
            <span className="text-sm font-medium text-ink-800 truncate min-w-0 flex-1" title={title}>
              {title}
            </span>
          ) : (
            <div className="min-w-0 flex-1 truncate">{title}</div>
          )}
          {meta && <div className="flex items-center gap-2 shrink-0 flex-wrap">{meta}</div>}
        </div>
        {subtitle && (
          typeof subtitle === "string" ? (
            <p className="text-xs text-ink-400 mt-0.5 truncate" title={subtitle}>{subtitle}</p>
          ) : (
            <div className="text-xs text-ink-400 mt-0.5 truncate">{subtitle}</div>
          )
        )}
        {extra}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end self-center">
          {actions}
        </div>
      )}
    </div>
  );
}

export function ScopeBadge({ scope }: { scope: "system" | "user" }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
      scope === "user" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
    }`}>
      {scope === "user" ? "我的" : "系统"}
    </span>
  );
}
