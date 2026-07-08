import type { ReactNode } from "react";
import type { McpServerItem, McpServerStatus } from "../api/mcp";

export function mcpServerStatusKey(scope: string, name: string): string {
  return `${scope}:${name}`;
}

interface McpServerStatusBadgeProps {
  status?: McpServerStatus;
  probing: boolean;
  serverEnabled: boolean;
}

export function McpServerStatusBadge({ status, probing, serverEnabled }: McpServerStatusBadgeProps) {
  if (!serverEnabled) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink-100 text-ink-500">
        已禁用
      </span>
    );
  }
  if (probing && !status) {
    return <span className="text-[10px] text-ink-400">检测中…</span>;
  }
  if (!status) {
    return <span className="text-[10px] text-ink-400">未测试</span>;
  }
  if (status.skipped) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink-100 text-ink-500">
        已跳过
      </span>
    );
  }
  if (status.available) {
    const latency = status.latency_ms ? ` · ${status.latency_ms}ms` : "";
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
        可用 · {status.tool_count} tools{latency}
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

interface McpToolListProps {
  tools: string[];
  expanded: boolean;
  onToggle: () => void;
}

export function McpToolList({ tools, expanded, onToggle }: McpToolListProps) {
  if (tools.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="text-[11px] text-sky-700 hover:text-sky-900"
      >
        {expanded ? "收起 tools" : `展开 tools (${tools.length})`}
      </button>
      {expanded && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {tools.map((tool) => (
            <li
              key={tool}
              className="text-[10px] px-1.5 py-0.5 rounded bg-ink-50 text-ink-600 font-mono"
            >
              {tool}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface McpServerRowProps {
  server: McpServerItem;
  status?: McpServerStatus;
  probing: boolean;
  toolsExpanded: boolean;
  scopeBadge: ReactNode;
  canToggleEnabled?: boolean;
  onToggleEnabled?: (enabled: boolean) => void;
  onProbe: () => void;
  onToggleTools: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function McpServerRow({
  server,
  status,
  probing,
  toolsExpanded,
  scopeBadge,
  canToggleEnabled = true,
  onToggleEnabled,
  onProbe,
  onToggleTools,
  onEdit,
  onDelete,
}: McpServerRowProps) {
  const enabled = server.enabled !== false;

  return (
    <div className="border border-ink-200/60 rounded-xl px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {scopeBadge}
            <span className="text-sm font-medium text-ink-800">{server.name}</span>
            {server.has_api_key && (
              <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                已配置 API Key
              </span>
            )}
            <McpServerStatusBadge status={status} probing={probing} serverEnabled={enabled} />
          </div>
          <p className="text-xs text-ink-400 truncate mt-0.5">{server.url}</p>
          {server.description && (
            <p className="text-xs text-ink-400 mt-0.5">{server.description}</p>
          )}
          {status?.tools && status.tools.length > 0 && (
            <McpToolList tools={status.tools} expanded={toolsExpanded} onToggle={onToggleTools} />
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {canToggleEnabled && onToggleEnabled && (
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => onToggleEnabled(e.target.checked)}
              />
              启用
            </label>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onProbe}
              disabled={probing}
              className="text-xs px-3 py-1 border border-sky-200 rounded-lg text-sky-700 hover:bg-sky-50 disabled:opacity-50"
            >
              {probing ? "测试中…" : "测试"}
            </button>
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50"
              >
                编辑
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50"
              >
                删除
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
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
