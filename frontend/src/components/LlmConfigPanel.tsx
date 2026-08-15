import { useCallback, useEffect, useRef, useState } from "react";
import { configApi, LlmProfile, LlmProfileCreate } from "../api/config";
import { ConfigActionBtn, ConfigPrimaryBtn } from "./config/ConfigActionBtn";
import { ConfigListItem } from "./config/ConfigListItem";
import {
  ConfigEmptyState,
  ConfigListPagination,
  ConfigListToolbar,
  ConfigPanelLayout,
} from "./config/ConfigPanelLayout";
import { ModalOverlay } from "./config/ModalOverlay";
import { CONFIG_PAGE_SIZE, useClientPagination } from "./config/useClientPagination";

const EMPTY_FORM: LlmProfileCreate = {
  name: "",
  base_url: "",
  api_key: "",
  model: "",
  timeout: 120,
  protocol: "openai",
};

const PRESETS: Record<string, Partial<LlmProfileCreate>> = {
  openai: { protocol: "openai", base_url: "https://api.openai.com/v1", model: "gpt-4o" },
  anthropic: { protocol: "anthropic", base_url: "https://api.anthropic.com", model: "claude-opus-4-5-20251101" },
  dashscope: { protocol: "openai", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-max" },
  deepseek: { protocol: "openai", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
};

type ModalState =
  | { mode: "create"; form: LlmProfileCreate }
  | { mode: "edit"; profile: LlmProfile; form: LlmProfileCreate };

interface LlmConfigPanelProps {
  /** 为 true 时不在面板内渲染「添加」（由外层 Tab 行右上角统一放置） */
  hideToolbarAdd?: boolean;
  /** 外层递增该值以触发打开「添加」弹窗 */
  createRequestId?: number;
}

export default function LlmConfigPanel({
  hideToolbarAdd = false,
  createRequestId = 0,
}: LlmConfigPanelProps) {
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const lastCreateRequestId = useRef(createRequestId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await configApi.listLlmProfiles();
      setProfiles(res.items);
      setActiveId(res.active_id);
      setIntentId(res.intent_id);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSelect = async (id: string) => {
    if (id === activeId) return;
    setErrMsg(null);
    try {
      await configApi.activateLlmProfile(id);
      setActiveId(id);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "切换失败");
    }
  };

  const handleAssignIntent = async (id: string | null) => {
    if (id === intentId) return;
    setErrMsg(null);
    try {
      const res = await configApi.assignIntentLlmProfile(id);
      setProfiles(res.items);
      setActiveId(res.active_id);
      setIntentId(res.intent_id);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "意图模型设置失败");
    }
  };

  const openCreate = useCallback(() => {
    setModal({
      mode: "create",
      form: { ...EMPTY_FORM, name: `配置 ${profiles.length + 1}` },
    });
  }, [profiles.length]);

  useEffect(() => {
    if (createRequestId === lastCreateRequestId.current) return;
    lastCreateRequestId.current = createRequestId;
    if (createRequestId > 0) openCreate();
  }, [createRequestId, openCreate]);

  const openEdit = (profile: LlmProfile) => {
    setModal({
      mode: "edit",
      profile,
      form: {
        name: profile.name,
        base_url: profile.base_url,
        api_key: profile.api_key,
        model: profile.model,
        timeout: profile.timeout,
        protocol: profile.protocol,
      },
    });
  };

  const handleModalSave = async () => {
    if (!modal) return;
    setSaving(true);
    setErrMsg(null);
    try {
      if (modal.mode === "create") {
        const created = await configApi.createLlmProfile(modal.form);
        await configApi.activateLlmProfile(created.id);
      } else {
        await configApi.updateLlmProfile(modal.profile.id, modal.form);
      }
      setModal(null);
      await load();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (profile: LlmProfile) => {
    if (!confirm(`确认删除 LLM 配置「${profile.name}」？`)) return;
    setErrMsg(null);
    try {
      await configApi.deleteLlmProfile(profile.id);
      await load();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleTest = async (profile: LlmProfile) => {
    setErrMsg(null);
    setTestingIds((prev) => new Set(prev).add(profile.id));
    try {
      const result = await configApi.testLlmProfile(profile.id);
      const message = result.ok
        ? `${result.message}${result.latency_ms ? ` · ${result.latency_ms}ms` : ""}`
        : result.message || "测试失败";
      setTestResults((prev) => ({ ...prev, [profile.id]: { ok: result.ok, message } }));
      if (!result.ok) setErrMsg(`「${profile.name}」测试失败：${message}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "测试失败";
      setTestResults((prev) => ({ ...prev, [profile.id]: { ok: false, message } }));
      setErrMsg(`「${profile.name}」测试失败：${message}`);
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(profile.id);
        return next;
      });
    }
  };

  const pagination = useClientPagination(profiles, CONFIG_PAGE_SIZE);

  return (
    <>
      <ConfigPanelLayout
        loading={loading}
        loadingText="加载 LLM 配置…"
        errMsg={errMsg}
        toolbar={(
          <ConfigListToolbar
            left={(
              <IntentModelSelect
                profiles={profiles}
                intentId={intentId}
                onChange={(id) => void handleAssignIntent(id)}
              />
            )}
            right={
              hideToolbarAdd
                ? undefined
                : <ConfigPrimaryBtn onClick={openCreate}>添加</ConfigPrimaryBtn>
            }
          />
        )}
        pagination={(
          <ConfigListPagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onPageChange={pagination.setPage}
          />
        )}
      >
        {profiles.length === 0 ? (
          <ConfigEmptyState message="暂无 LLM 配置，点击「添加」创建" />
        ) : (
          <div className="space-y-2">
            {pagination.slice.map((profile) => {
              const testing = testingIds.has(profile.id);
              const testResult = testResults[profile.id];
              return (
                <ConfigListItem
                  key={profile.id}
                  leading={(
                    <input
                      type="radio"
                      name="llm-profile"
                      checked={activeId === profile.id}
                      onChange={() => void handleSelect(profile.id)}
                      className="accent-brand-600 mt-1"
                    />
                  )}
                  title={profile.name}
                  meta={(
                    <>
                      {activeId === profile.id && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-brand-50 text-brand-700">
                          当前生效
                        </span>
                      )}
                      {intentId === profile.id && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-sky-50 text-sky-700">
                          意图识别
                        </span>
                      )}
                      {testing && !testResult && (
                        <span className="text-[10px] text-ink-400">测试中…</span>
                      )}
                      {testResult && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full max-w-[220px] truncate ${
                            testResult.ok
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                          title={testResult.message}
                        >
                          {testResult.ok ? `可用 · ${testResult.message}` : "不可用"}
                        </span>
                      )}
                    </>
                  )}
                  subtitle={`${profile.protocol} · ${profile.model} · ${profile.base_url}`}
                  actions={(
                    <>
                      <ConfigActionBtn
                        variant="sky"
                        disabled={testing}
                        onClick={() => void handleTest(profile)}
                      >
                        {testing ? "测试中…" : "测试"}
                      </ConfigActionBtn>
                      <ConfigActionBtn onClick={() => openEdit(profile)}>编辑</ConfigActionBtn>
                      <ConfigActionBtn
                        variant="danger"
                        disabled={profiles.length <= 1}
                        onClick={() => void handleDelete(profile)}
                      >
                        删除
                      </ConfigActionBtn>
                    </>
                  )}
                />
              );
            })}
          </div>
        )}
      </ConfigPanelLayout>

      {modal && (
        <LlmProfileModal
          modal={modal}
          saving={saving}
          onChange={(form) => setModal({ ...modal, form })}
          onSave={() => void handleModalSave()}
          onCancel={() => setModal(null)}
        />
      )}
    </>
  );
}

function IntentModelSelect({
  profiles,
  intentId,
  onChange,
}: {
  profiles: LlmProfile[];
  intentId: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <label className="flex items-center gap-2 min-w-0 w-full max-w-xl">
      <span className="text-[11px] text-ink-500 shrink-0">意图识别小模型</span>
      <select
        value={intentId ?? ""}
        disabled={profiles.length === 0}
        onChange={(e) => onChange(e.target.value || null)}
        className="ui-field min-w-0 flex-1 text-sm"
        title="可选。未配置时用当前生效的聊天大模型"
      >
        <option value="">未配置（用当前聊天大模型）</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} · {profile.model}
          </option>
        ))}
      </select>
    </label>
  );
}

function LlmProfileModal({
  modal, saving, onChange, onSave, onCancel,
}: {
  modal: ModalState;
  saving: boolean;
  onChange: (form: LlmProfileCreate) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const form = modal.form;
  const [showKey, setShowKey] = useState(false);
  const set = (patch: Partial<LlmProfileCreate>) => onChange({ ...form, ...patch });

  return (
    <ModalOverlay onBackdropClick={onCancel}>
      {/* 与工具 MCP 添加弹框同款：内容自适应高度，居中于视口 */}
      <div
        className="bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-ink-200/60 shrink-0">
          <h2 className="font-semibold text-ink-900">
            {modal.mode === "create" ? "添加 LLM 配置" : `编辑 · ${modal.profile.name}`}
          </h2>
        </div>
        <div className="px-6 py-4 space-y-3 overflow-y-auto min-h-0 flex-1">
          <div className="flex gap-2 flex-wrap">
            {Object.entries(PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                onClick={() => onChange({ ...form, ...preset })}
                className="text-xs px-3 py-1 border border-ink-200 rounded-full hover:bg-brand-50"
              >
                {key}
              </button>
            ))}
          </div>
          <input
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="配置名称"
            className="ui-field w-full"
          />
          <select
            value={form.protocol}
            onChange={(e) => set({ protocol: e.target.value as LlmProfileCreate["protocol"] })}
            className="ui-field w-full"
          >
            <option value="openai">OpenAI-compatible</option>
            <option value="anthropic">Anthropic Messages API</option>
          </select>
          <input
            type="url"
            value={form.base_url}
            onChange={(e) => set({ base_url: e.target.value })}
            placeholder="Base URL"
            className="ui-field w-full"
          />
          <div className="flex gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={form.api_key}
              onChange={(e) => set({ api_key: e.target.value })}
              placeholder="API Key"
              className="ui-field flex-1"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)} className="text-xs px-2 border border-ink-200 rounded-lg">
              {showKey ? "隐藏" : "显示"}
            </button>
          </div>
          <input
            value={form.model}
            onChange={(e) => set({ model: e.target.value })}
            placeholder="模型"
            className="ui-field w-full"
          />
          <input
            type="number"
            value={form.timeout}
            onChange={(e) => set({ timeout: Number(e.target.value) })}
            min={10}
            max={600}
            placeholder="超时（秒）"
            className="ui-field w-full"
          />
        </div>
        <div className="px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2 shrink-0">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-ink-200 rounded-xl">
            取消
          </button>
          <button
            type="button"
            disabled={saving || !form.name.trim() || !form.base_url.trim() || !form.model.trim()}
            onClick={onSave}
            className="ui-btn-primary"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
