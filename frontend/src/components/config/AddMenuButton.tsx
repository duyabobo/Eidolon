import { useEffect, useRef, useState } from "react";
import { ConfigPrimaryBtn } from "./ConfigActionBtn";

export interface AddMenuItem {
  id: string;
  label: string;
  hint?: string;
  onClick: () => void;
}

interface Props {
  items: AddMenuItem[];
  disabled?: boolean;
}

/** 「添加」下拉：同一入口给出两种添加方式。 */
export function AddMenuButton({ items, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <ConfigPrimaryBtn
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        添加
      </ConfigPrimaryBtn>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-20 min-w-[220px] rounded-xl border border-ink-200/80 bg-white shadow-panel py-1"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="w-full text-left px-3.5 py-2 hover:bg-ink-50"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              <p className="text-xs font-medium text-ink-800">{item.label}</p>
              {item.hint && <p className="text-[11px] text-ink-400 mt-0.5">{item.hint}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
