import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  children: ReactNode;
  /** 点击遮罩关闭；子面板需自行 stopPropagation */
  onBackdropClick?: () => void;
  zClass?: string;
}

/**
 * 全屏弹层外壳：portal 到 document.body，与经验/工具添加弹框同款居中布局。
 * 避免挂在 ManagePageLayout（overflow + backdrop-blur）内时 fixed 相对卡片定位、顶部被裁切。
 */
export function ModalOverlay({
  children,
  onBackdropClick,
  zClass = "z-50",
}: Props) {
  return createPortal(
    <div
      className={`fixed inset-0 ${zClass} bg-ink-900/30 backdrop-blur-sm flex items-center justify-center p-4`}
      onClick={onBackdropClick}
      role="presentation"
    >
      {children}
    </div>,
    document.body,
  );
}
