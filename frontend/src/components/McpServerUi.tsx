import type { McpScope } from "../api/mcp";

export interface McpServerStatus {
  name: string;
  scope: McpScope;
  url: string;
  available: boolean;
  tool_count: number;
  error?: string;
  latency_ms?: number;
}

export function mcpServerStatusKey(scope: McpScope, name: string): string {
  return `${scope}:${name}`;
}

interface McpServerStatusBadgeProps {
  statusKey: string;
  statusMap: Record<string, McpServerStatus>;
  probing: boolean;
}

export function McpServerStatusBadge({ statusKey, statusMap, probing }: McpServerStatusBadgeProps) {
  const status = statusMap[statusKey];

  if (probing && !status) {
    return <span className="text-[10px] text-ink-400">检测中…</span>;
  }
  if (!status) {
    return null;
  }
  if (status.available) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
        可用 · {status.tool_count} tools
      </span>
    );
  }
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 max-w-[220px] truncate"
      title={status.error || "连接失败"}
    >
      不可用
    </span>
  );
}

interface McpEditModalProps {
  title: string;
  config: {
    url: string;
    description?: string;
    enabled?: boolean;
    api_key?: string;
  };
  nameReadonly?: boolean;
  name?: string;
  onNameChange?: (name: string) => void;
  onChange: (patch: Partial<McpEditModalProps["config"]>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function McpEditModal({
  title,
  config,
  nameReadonly = true,
  name = "",
  onNameChange,
  onChange,
  onSave,
  onCancel,
}: McpEditModalProps) {
  return (
    <div className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60">
        <div className="px-6 py-4 border-b border-ink-200/60">
          <h2 className="font-semibold text-ink-900">{title}</h2>
        </div>
        <div className="px-6 py-4 space-y-3">
          {!nameReadonly ? (
            <input
              value={name}
              onChange={(e) => onNameChange?.(e.target.value)}
              placeholder="server 名称"
              className="ui-field w-full"
            />
          ) : name ? (
            <input value={name} readOnly className="ui-field w-full bg-ink-50 text-ink-500" />
          ) : null}
          <input
            value={config.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="URL"
            className="ui-field w-full"
          />
          <input
            value={config.description ?? ""}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="描述（可选）"
            className="ui-field w-full"
          />
          <input
            type="password"
            value={config.api_key ?? ""}
            onChange={(e) => onChange({ api_key: e.target.value })}
            placeholder="API Key（可选，留空则不修改已保存的 Key）"
            className="ui-field w-full"
            autoComplete="off"
          />
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={config.enabled !== false}
              onChange={(e) => onChange({ enabled: e.target.checked })}
            />
            启用
          </label>
        </div>
        <div className="px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-ink-600 border border-ink-200 rounded-xl">
            取消
          </button>
          <button type="button" onClick={onSave} className="ui-btn-primary">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
