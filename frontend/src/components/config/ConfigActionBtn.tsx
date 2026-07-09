import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "default" | "primary" | "danger" | "sky" | "brand" | "violet";

const VARIANT_CLS: Record<Variant, string> = {
  default: "border-ink-200 text-ink-600 hover:bg-ink-50",
  primary: "border-brand-200 text-brand-700 hover:bg-brand-50",
  sky: "border-sky-200 text-sky-700 hover:bg-sky-50",
  brand: "border-brand-200 text-brand-700 hover:bg-brand-50",
  violet: "border-violet-200 text-violet-700 hover:bg-violet-50",
  danger: "border-rose-200 text-rose-600 hover:bg-rose-50",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function ConfigActionBtn({ variant = "default", className = "", children, ...rest }: Props) {
  return (
    <button
      type="button"
      className={`text-xs px-3 py-1 border rounded-lg disabled:opacity-50 ${VARIANT_CLS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ConfigToolbarBtn({ className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`text-sm px-3 py-1.5 border border-ink-200 rounded-lg text-ink-700 hover:bg-ink-50 disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ConfigPrimaryBtn({ className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`text-xs px-3 py-1.5 font-medium text-white rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
