import LlmConfigPanel from "../LlmConfigPanel";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 模型配置改到对话页内直接打开，不再是独立导航页面；面板本身（含 profile 增删改、
 * 「当前生效」单选、意图识别小模型）完全复用 LlmConfigPanel，这里只包一层弹窗外壳。
 */
export default function ModelConfigModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-panel w-full max-w-2xl border border-ink-200/60 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-ink-200/60">
          <h2 className="text-base font-semibold text-ink-900">模型配置</h2>
          <button type="button" onClick={onClose} className="ui-icon-btn" aria-label="关闭">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">
          <LlmConfigPanel />
        </div>
      </div>
    </div>
  );
}
