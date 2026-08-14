import { useEffect, useRef, useState, type ReactNode } from "react";
import type { McpServerItem, McpServerStatus } from "../api/mcp";
import { ConfigActionBtn } from "./config/ConfigActionBtn";
import { ConfigListItem } from "./config/ConfigListItem";
import { ModalOverlay } from "./config/ModalOverlay";

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

interface McpToolListModalProps {
  serverName: string;
  status: McpServerStatus;
  onClose: () => void;
}

/** 测试结果弹框：展示 tool list（或失败原因） */
export function McpToolListModal({ serverName, status, onClose }: McpToolListModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tools = status.tools ?? [];
  const ok = status.available && !status.skipped;

  return (
    <ModalOverlay onBackdropClick={onClose} zClass="z-[60]">
      <div
        className="bg-white rounded-2xl shadow-panel border border-ink-100 w-full max-w-lg h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 py-4 border-b border-ink-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink-900">测试结果</h2>
            <p className="text-[11px] text-ink-400 mt-0.5 font-mono truncate">{serverName}</p>
          </div>
          <button type="button" onClick={onClose} className="ui-icon-btn shrink-0" aria-label="关闭">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {status.skipped ? (
              <span className="text-xs px-2 py-1 rounded-lg bg-ink-100 text-ink-600">已跳过</span>
            ) : ok ? (
              <span className="text-xs px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700">
                可用{status.latency_ms ? ` · ${status.latency_ms}ms` : ""}
              </span>
            ) : (
              <span className="text-xs px-2 py-1 rounded-lg bg-rose-50 text-rose-700">不可用</span>
            )}
            {ok && <span className="text-xs text-ink-500">{tools.length} tools</span>}
          </div>

          {!ok && status.error && (
            <p className="text-sm px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-100">
              {status.error}
            </p>
          )}

          {ok && tools.length === 0 && (
            <p className="text-sm text-ink-400">连接成功，但未返回 tool</p>
          )}

          {ok && tools.length > 0 && (
            <ul className="divide-y divide-ink-100 border border-ink-200/60 rounded-xl overflow-hidden">
              {tools.map((tool) => (
                <li
                  key={tool}
                  className="px-3.5 py-2.5 text-sm font-mono text-ink-800 truncate"
                  title={tool}
                >
                  {tool}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

interface McpServerRowProps {
  server: McpServerItem;
  status?: McpServerStatus;
  probing: boolean;
  scopeBadge: ReactNode;
  canToggleEnabled?: boolean;
  onToggleEnabled?: (enabled: boolean) => void;
  onProbe: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function McpServerRow({
  server,
  status,
  probing,
  scopeBadge,
  canToggleEnabled = true,
  onToggleEnabled,
  onProbe,
  onEdit,
  onDelete,
}: McpServerRowProps) {
  const enabled = server.enabled !== false;
  const [resultOpen, setResultOpen] = useState(false);
  const wasProbingRef = useRef(false);

  // 测试结束后自动弹出结果（含 tool list）
  useEffect(() => {
    if (wasProbingRef.current && !probing && status) {
      setResultOpen(true);
    }
    wasProbingRef.current = probing;
  }, [probing, status]);

  return (
    <>
      <ConfigListItem
        title={server.name}
        meta={(
          <>
            {scopeBadge}
            {server.has_api_key && (
              <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                已配置 API Key
              </span>
            )}
            <McpServerStatusBadge status={status} probing={probing} serverEnabled={enabled} />
          </>
        )}
        subtitle={server.url}
        extra={(
          <>
            {server.description && (
              <p className="text-xs text-ink-400 mt-0.5 truncate" title={server.description}>
                {server.description}
              </p>
            )}
            {status && (
              <button
                type="button"
                onClick={() => setResultOpen(true)}
                className="mt-1.5 text-[11px] text-sky-700 hover:text-sky-900"
              >
                {status.available && (status.tools?.length ?? 0) > 0
                  ? `查看 tools (${status.tools.length})`
                  : "查看测试结果"}
              </button>
            )}
          </>
        )}
        actions={(
          <>
            {canToggleEnabled && onToggleEnabled && (
              <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer mr-1">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => onToggleEnabled(e.target.checked)}
                />
                启用
              </label>
            )}
            <ConfigActionBtn variant="sky" disabled={probing} onClick={onProbe}>
              {probing ? "测试中…" : "测试"}
            </ConfigActionBtn>
            {onEdit && <ConfigActionBtn onClick={onEdit}>编辑</ConfigActionBtn>}
            {onDelete && <ConfigActionBtn variant="danger" onClick={onDelete}>删除</ConfigActionBtn>}
          </>
        )}
      />

      {resultOpen && status && (
        <McpToolListModal
          serverName={server.name}
          status={status}
          onClose={() => setResultOpen(false)}
        />
      )}
    </>
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
    <ModalOverlay>
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
    </ModalOverlay>
  );
}
