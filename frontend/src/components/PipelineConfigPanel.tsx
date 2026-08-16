import { useCallback, useEffect, useState, type ReactNode } from "react";
import { configApi, type IntentLlmConfig } from "../api/config";
import {
  knowledgeApi,
  type KnowledgePipelineConfig,
} from "../api/knowledge";
import { ConfigActionBtn } from "./config/ConfigActionBtn";
import { ConfigListItem } from "./config/ConfigListItem";
import { ConfigPanelLayout } from "./config/ConfigPanelLayout";

type SmallModelId = "intent" | "mineru";

interface EndpointForm {
  base_url: string;
  api_key: string;
  model: string;
}

const EMPTY_PIPELINE: KnowledgePipelineConfig = {
  mineru3_api_base: "",
  mineru3_api_key: "",
};

const EMPTY_INTENT: IntentLlmConfig = {
  base_url: "",
  api_key: "",
  model: "",
};

const PRESET_ITEMS: { id: SmallModelId; title: string }[] = [
  { id: "intent", title: "意图识别小模型" },
  { id: "mineru", title: "文件解析小模型" },
];

type EditState =
  | { id: "intent"; form: EndpointForm }
  | { id: "mineru"; form: EndpointForm };

function intentFromConfig(cfg: IntentLlmConfig): EndpointForm {
  return { base_url: cfg.base_url, api_key: cfg.api_key ?? "", model: cfg.model };
}

function mineruFromConfig(cfg: KnowledgePipelineConfig): EndpointForm {
  return { base_url: cfg.mineru3_api_base, api_key: cfg.mineru3_api_key ?? "", model: "" };
}

function isIntentConfigured(cfg: IntentLlmConfig): boolean {
  return Boolean(cfg.base_url.trim() && cfg.model.trim());
}

function isMineruConfigured(cfg: KnowledgePipelineConfig): boolean {
  return Boolean(cfg.mineru3_api_base.trim());
}

function intentSubtitle(cfg: IntentLlmConfig): string {
  if (!isIntentConfigured(cfg)) return "未配置";
  return `${cfg.model} · ${cfg.base_url}`;
}

function mineruSubtitle(cfg: KnowledgePipelineConfig): string {
  const url = cfg.mineru3_api_base.trim();
  return url ? `mineru · ${url}` : "未配置";
}

function canSaveIntent(form: EndpointForm): boolean {
  const url = form.base_url.trim();
  const model = form.model.trim();
  const blank = !url && !form.api_key.trim() && !model;
  return blank || Boolean(url && model);
}

/**
 * 配置页「小模型」：意图识别 + 文件解析，列表交互对齐。
 */
export default function PipelineConfigPanel() {
  const [pipeline, setPipeline] = useState<KnowledgePipelineConfig>(EMPTY_PIPELINE);
  const [intent, setIntent] = useState<IntentLlmConfig>(EMPTY_INTENT);
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
      const [nextPipeline, nextIntent] = await Promise.all([
        knowledgeApi.getPipelineConfig(),
        configApi.getIntentLlm(),
      ]);
      setPipeline(nextPipeline);
      setIntent(nextIntent);
    } catch (e) {
      setPipeline(EMPTY_PIPELINE);
      setIntent(EMPTY_INTENT);
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
      setEdit({ id, form: intentFromConfig(intent) });
      return;
    }
    setEdit({ id, form: mineruFromConfig(pipeline) });
  };

  const handleSave = async () => {
    if (!edit) return;
    setSaving(true);
    setErrMsg(null);
    try {
      if (edit.id === "intent") {
        const saved = await configApi.saveIntentLlm({
          ...intent,
          base_url: edit.form.base_url.trim(),
          api_key: edit.form.api_key.trim(),
          model: edit.form.model.trim(),
        });
        setIntent(saved);
      } else {
        const saved = await knowledgeApi.savePipelineConfig({
          ...pipeline,
          mineru3_api_base: edit.form.base_url.trim(),
          mineru3_api_key: edit.form.api_key.trim(),
        });
        setPipeline(saved);
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
        ? await configApi.testIntentLlm(intent)
        : await knowledgeApi.testMineru(pipeline);
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

  return (
    <ConfigPanelLayout loading={loading} loadingText="加载小模型配置…" errMsg={errMsg}>
      <div className="space-y-2">
        {PRESET_ITEMS.map((item) => {
          const testing = testingIds.has(item.id);
          const testResult = testResults[item.id];
          const configured = item.id === "intent"
            ? isIntentConfigured(intent)
            : isMineruConfigured(pipeline);
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
                item.id === "intent" ? intentSubtitle(intent) : mineruSubtitle(pipeline)
              }
              actions={(
                <>
                  <ConfigActionBtn
                    variant="sky"
                    disabled={testing || !configured}
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

      {edit && (
        <SmallModelModal
          title={`编辑 · ${titleOf(edit.id)}`}
          form={edit.form}
          showModel={edit.id === "intent"}
          saving={saving}
          canSave={edit.id === "intent" ? canSaveIntent(edit.form) : Boolean(edit.form.base_url.trim())}
          onChange={(form) => setEdit({ ...edit, form })}
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

function SmallModelModal({
  title,
  form,
  showModel,
  saving,
  canSave,
  onChange,
  onSave,
  onCancel,
}: {
  title: string;
  form: EndpointForm;
  showModel: boolean;
  saving: boolean;
  canSave: boolean;
  onChange: (form: EndpointForm) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const set = (patch: Partial<EndpointForm>) => onChange({ ...form, ...patch });

  return (
    <SmallModelDialog title={title} saving={saving} canSave={canSave} onSave={onSave} onCancel={onCancel}>
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
      {showModel && (
        <input
          value={form.model}
          onChange={(e) => set({ model: e.target.value })}
          placeholder="模型"
          className="ui-field w-full"
        />
      )}
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
