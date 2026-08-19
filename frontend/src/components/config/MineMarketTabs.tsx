import type { ReactNode } from "react";
import { AddMenuButton, type AddMenuItem } from "./AddMenuButton";
import { ConfigPrimaryBtn } from "./ConfigActionBtn";

export type MineMarketTab = "mine" | "market";

const TABS: { id: MineMarketTab; label: string }[] = [
  { id: "mine", label: "我的" },
  { id: "market", label: "市场" },
];

interface ToolbarProps {
  tab: MineMarketTab;
  onTabChange: (tab: MineMarketTab) => void;
  onAdd?: () => void;
  addItems?: AddMenuItem[];
  addDisabled?: boolean;
  /** 工具栏右侧附加操作（可选） */
  extraActions?: ReactNode;
}

/** 「我的 / 市场」切换 + 「添加」按钮 */
export function MineMarketToolbar({
  tab,
  onTabChange,
  onAdd,
  addItems,
  addDisabled,
  extraActions,
}: ToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex gap-1 p-0.5 rounded-lg bg-ink-100/70">
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                active
                  ? "bg-white text-ink-900 shadow-sm"
                  : "text-ink-500 hover:text-ink-700"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {(extraActions || tab === "mine") && (
        <div className="flex items-center gap-2 shrink-0">
          {extraActions}
          {tab === "mine" && addItems && addItems.length > 0 && (
            <AddMenuButton items={addItems} disabled={addDisabled} />
          )}
          {tab === "mine" && (!addItems || addItems.length === 0) && onAdd && (
            <ConfigPrimaryBtn disabled={addDisabled} onClick={onAdd}>
              添加
            </ConfigPrimaryBtn>
          )}
        </div>
      )}
    </div>
  );
}

/** 市场 Tab 内联占位（不跳转） */
export function MarketComingSoon({ subtitle }: { subtitle?: string }) {
  return (
    <div className="py-16 text-center space-y-2 border border-dashed border-ink-200 rounded-xl">
      <p className="text-base font-medium text-ink-700">待开发</p>
      <p className="text-sm text-ink-400">
        {subtitle ?? "该功能正在规划中，敬请期待"}
      </p>
    </div>
  );
}
