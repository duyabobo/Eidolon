import { useCallback, useEffect, useState, type ReactNode } from "react";
import { configApi, type LlmProfile } from "../api/config";
import {
  knowledgeApi,
  type KnowledgePipelineConfig,
} from "../api/knowledge";
import { ConfigActionBtn } from "./config/ConfigActionBtn";
import { ConfigListItem } from "./config/ConfigListItem";
import { ConfigPanelLayout } from "./config/ConfigPanelLayout";

type SmallModelId = "intent" | "mineru";

interface SmallModelForm {
  base_url: string;
  api_key: string;
}

const EMPTY_PIPELINE: KnowledgePipelineConfig = {
  mineru3_api_base: "",
  mineru3_api_key: "",
};

const PRESET_ITEMS: { id: SmallModelId; title: string }[] = [
  { id: "intent", title: "意图识别小模型" },
  { id: "mineru", title: "文件解析小模型" },
];

type EditState =
  | { id: "intent"; profileId: string | null }
  | { id: "mineru"; form: SmallModelForm };

function formFromConfig(cfg: KnowledgePipelineConfig): SmallModelForm {
  return { base_url: cfg.mineru3_api_base, api_key: cfg.mineru3_api_key ?? "" };
}

function applyForm(cfg: KnowledgePipelineConfig, form: SmallModelForm): KnowledgePipelineConfig {
  return { ...cfg, mineru3_api_base: form.base_url.trim(), mineru3_api_key: form.api_key.trim() };
}

function findProfile(profiles: LlmProfile[], id: string | null): LlmProfile | undefined {
  if (!id) return undefined;
  return profiles.find((item) => item.id === id);
}

function intentSubtitle(
  profiles: LlmProfile[],
  intentId: string | null,
  activeId: string | null,
): string {
  const selected = findProfile(profiles, intentId);
  if (selected) return `${selected.name} · ${selected.model}`;
  const fallback = findProfile(profiles, activeId);
  if (fallback) return `未配置（兜底：${fallback.name}）`;
  return "未配置（用当前聊天大模型）";
}

function mineruSubtitle(cfg: KnowledgePipelineConfig): string {
  const url = cfg.mineru3_api_base.trim();
  return url ? `mineru · ${url}` : "未配置";
}

/**
 * 配置页「小模型」：意图识别 + 文件解析，列表交互对齐大模型。
 */
export default function PipelineConfigPanel() {
  const [cfg, setCfg] = useState<KnowledgePipelineConfig>(EMPTY_PIPELINE);
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingIds, setTestingIds] = useState<Set<SmallModelId>>(new Set());
  const [testResults, setTestResults] = useState<
    Partial<Record<SmallModelId, { ok: boolean; message: string }>>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pipeline, llm] = await Promise.all([
        knowledgeApi.getPipelineConfig(),
        configApi.listLlmProfiles(),
      ]);
      setCfg(pipeline);
      setProfiles(llm.items);
      setActiveId(llm.active_id);
      setIntentId(llm.intent_id);
    } catch (e) {
      setCfg(EMPTY_PIPELINE);
      setErrMsg(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (id: SmallModelId) => {
    setErrMsg(null);
    if (id === "intent") {
      setEdit({ id, profileId: intentId });
      return;
    }
    setEdit({ id, form: formFromConfig(cfg) });
  };

  const handleSave = async () => {
    if (!edit) return;
    setSaving(true);
    setErrMsg(null);
    try {
      if (edit.id === "intent") {
        const res = await configApi.assignIntentLlmProfile(edit.profileId);
        setProfiles(res.items);
        setActiveId(res.active_id);
        setIntentId(res.intent_id);
      } else {
        const saved = await knowledgeApi.savePipelineConfig(applyForm(cfg, edit.form));
        setCfg(saved);
      }
      setTestResults((prev) => {
        const cleared = { ...prev };
        delete cleared[edit.id];
        return cleared;
      });
      setEdit(null);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (id: SmallModelId) => {
    setErrMsg(null);
    setTestingIds((prev) => new Set(prev).add(id));
    try {
      const result = id === "intent"
        ? await testIntentProfile(intentId, activeId)
        : await knowledgeApi.testMineru(cfg);
      const message = result.ok
        ? `${result.message}${result.latency_ms ? ` · ${result.latency_ms}ms` : ""}`
        : result.message || "测试失败";
      setTestResults((prev) => ({ ...prev, [id]: { ok: result.ok, message } }));
      if (!result.ok) setErrMsg(`「${titleOf(id)}」测试失败：${message}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "测试失败";
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, message } }));
      setErrMsg(`「${titleOf(id)}」测试失败：${message}`);
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const intentConfigured = Boolean(intentId);
  const mineruConfigured = Boolean(cfg.mineru3_api_base.trim());

  return (
    <ConfigPanelLayout loading={loading} loadingText="加载小模型配置…" errMsg={errMsg}>
      <div className="space-y-2">
        {PRESET_ITEMS.map((item) => {
          const testing = testingIds.has(item.id);
          const testResult = testResults[item.id];
          const configured = item.id === "intent" ? intentConfigured : mineruConfigured;
          const canTest = item.id === "intent"
            ? Boolean(intentId || activeId)
            : mineruConfigured;
          return (
            <ConfigListItem
              key={item.id}
              title={item.title}
              meta={(
                <>
                  {configured ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-brand-50 text-brand-700">
                      已配置
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-ink-50 text-ink-400">
                      未配置
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
              subtitle={
                item.id === "intent"
                  ? intentSubtitle(profiles, intentId, activeId)
                  : mineruSubtitle(cfg)
              }
              actions={(
                <>
                  <ConfigActionBtn
                    variant="sky"
                    disabled={testing || !canTest}
                    onClick={() => void handleTest(item.id)}
                  >
                    {testing ? "测试中…" : "测试"}
                  </ConfigActionBtn>
                  <ConfigActionBtn onClick={() => openEdit(item.id)}>编辑</ConfigActionBtn>
                </>
              )}
            />
          );
        })}
      </div>

      {edit?.id === "intent" && (
        <IntentModelModal
          profiles={profiles}
          profileId={edit.profileId}
          saving={saving}
          onChange={(profileId) => setEdit({ id: "intent", profileId })}
          onSave={() => void handleSave()}
          onCancel={() => setEdit(null)}
        />
      )}
      {edit?.id === "mineru" && (
        <MineruModelModal
          form={edit.form}
          saving={saving}
          canSave={Boolean(edit.form.base_url.trim())}
          onChange={(form) => setEdit({ id: "mineru", form })}
          onSave={() => void handleSave()}
          onCancel={() => setEdit(null)}
        />
      )}
    </ConfigPanelLayout>
  );
}

function titleOf(id: SmallModelId): string {
  return PRESET_ITEMS.find((item) => item.id === id)?.title ?? id;
}

async function testIntentProfile(intentId: string | null, activeId: string | null) {
  const target = intentId || activeId;
  if (!target) {
    throw new Error("请先在「大模型」添加并激活聊天大模型");
  }
  return configApi.testLlmProfile(target);
}

function IntentModelModal({
  profiles,
  profileId,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  profiles: LlmProfile[];
  profileId: string | null;
  saving: boolean;
  onChange: (profileId: string | null) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <SmallModelDialog title="编辑 · 意图识别小模型" saving={saving} canSave onSave={onSave} onCancel={onCancel}>
      <select
        value={profileId ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="ui-field w-full"
      >
        <option value="">未配置（用当前聊天大模型）</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} · {profile.model}
          </option>
        ))}
      </select>
      <p className="text-xs text-ink-400">
        从「大模型」里选一条。不选则分流时用当前生效的聊天大模型。
      </p>
    </SmallModelDialog>
  );
}

function MineruModelModal({
  form,
  saving,
  canSave,
  onChange,
  onSave,
  onCancel,
}: {
  form: SmallModelForm;
  saving: boolean;
  canSave: boolean;
  onChange: (form: SmallModelForm) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const set = (patch: Partial<SmallModelForm>) => onChange({ ...form, ...patch });

  return (
    <SmallModelDialog
      title="编辑 · 文件解析小模型"
      saving={saving}
      canSave={canSave}
      onSave={onSave}
      onCancel={onCancel}
    >
      <input
        type="url"
        value={form.base_url}
        onChange={(e) => set({ base_url: e.target.value })}
        placeholder="Base URL / API"
        className="ui-field w-full"
      />
      <div className="flex gap-2">
        <input
          type={showKey ? "text" : "password"}
          value={form.api_key}
          onChange={(e) => set({ api_key: e.target.value })}
          placeholder="API Key（可选）"
          className="ui-field flex-1"
        />
        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          className="text-xs px-2 border border-ink-200 rounded-lg"
        >
          {showKey ? "隐藏" : "显示"}
        </button>
      </div>
    </SmallModelDialog>
  );
}

function SmallModelDialog({
  title,
  saving,
  canSave,
  onSave,
  onCancel,
  children,
}: {
  title: string;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-ink-200/60">
          <h2 className="font-semibold text-ink-900">{title}</h2>
        </div>
        <div className="px-6 py-4 space-y-3">{children}</div>
        <div className="px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm border border-ink-200 rounded-xl">
            取消
          </button>
          <button
            type="button"
            disabled={saving || !canSave}
            onClick={onSave}
            className="ui-btn-primary"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
