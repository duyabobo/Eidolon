import { useCallback, useEffect, useState } from "react";
import {
  knowledgeApi,
  type KnowledgePipelineConfig,
} from "../api/knowledge";
import { ConfigActionBtn } from "./config/ConfigActionBtn";
import { ConfigListItem } from "./config/ConfigListItem";
import { ConfigPanelLayout } from "./config/ConfigPanelLayout";

type SmallModelId = "mineru";

interface SmallModelForm {
  base_url: string;
  api_key: string;
}

const EMPTY_PIPELINE: KnowledgePipelineConfig = {
  mineru3_api_base: "",
  mineru3_api_key: "",
};

const PRESET_ITEMS: { id: SmallModelId; title: string }[] = [
  { id: "mineru", title: "mineru" },
];

function formFromConfig(cfg: KnowledgePipelineConfig): SmallModelForm {
  return { base_url: cfg.mineru3_api_base, api_key: cfg.mineru3_api_key ?? "" };
}

function applyForm(cfg: KnowledgePipelineConfig, form: SmallModelForm): KnowledgePipelineConfig {
  return { ...cfg, mineru3_api_base: form.base_url.trim(), mineru3_api_key: form.api_key.trim() };
}

function subtitleFor(cfg: KnowledgePipelineConfig): string {
  return cfg.mineru3_api_base.trim() || "未配置";
}

function isConfigured(cfg: KnowledgePipelineConfig): boolean {
  return Boolean(cfg.mineru3_api_base.trim());
}

/**
 * 配置页「小模型」：预设 mineru，列表交互对齐大模型。
 */
export default function PipelineConfigPanel() {
  const [cfg, setCfg] = useState<KnowledgePipelineConfig>(EMPTY_PIPELINE);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [editId, setEditId] = useState<SmallModelId | null>(null);
  const [form, setForm] = useState<SmallModelForm>({ base_url: "", api_key: "" });
  const [saving, setSaving] = useState(false);
  const [testingIds, setTestingIds] = useState<Set<SmallModelId>>(new Set());
  const [testResults, setTestResults] = useState<
    Partial<Record<SmallModelId, { ok: boolean; message: string }>>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await knowledgeApi.getPipelineConfig();
      setCfg(next);
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
    setForm(formFromConfig(cfg));
    setEditId(id);
  };

  const handleSave = async () => {
    if (!editId) return;
    setSaving(true);
    setErrMsg(null);
    try {
      const next = applyForm(cfg, form);
      const saved = await knowledgeApi.savePipelineConfig(next);
      setCfg(saved);
      setEditId(null);
      setTestResults((prev) => {
        const cleared = { ...prev };
        delete cleared[editId];
        return cleared;
      });
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
      const result = await knowledgeApi.testMineru(cfg);
      const message = result.ok
        ? `${result.message}${result.latency_ms ? ` · ${result.latency_ms}ms` : ""}`
        : result.message || "测试失败";
      setTestResults((prev) => ({ ...prev, [id]: { ok: result.ok, message } }));
      if (!result.ok) setErrMsg(`「${id}」测试失败：${message}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "测试失败";
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, message } }));
      setErrMsg(`「${id}」测试失败：${message}`);
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const canSave = Boolean(form.base_url.trim());

  return (
    <ConfigPanelLayout loading={loading} loadingText="加载小模型配置…" errMsg={errMsg}>
      <div className="space-y-2">
        {PRESET_ITEMS.map((item) => {
          const testing = testingIds.has(item.id);
          const testResult = testResults[item.id];
          const configured = isConfigured(cfg);
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
              subtitle={subtitleFor(cfg)}
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

      {editId && (
        <SmallModelModal
          title={`编辑 · ${editId}`}
          form={form}
          saving={saving}
          canSave={canSave}
          onChange={setForm}
          onSave={() => void handleSave()}
          onCancel={() => setEditId(null)}
        />
      )}
    </ConfigPanelLayout>
  );
}

function SmallModelModal({
  title,
  form,
  saving,
  canSave,
  onChange,
  onSave,
  onCancel,
}: {
  title: string;
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
    <div className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-ink-200/60">
          <h2 className="font-semibold text-ink-900">{title}</h2>
        </div>
        <div className="px-6 py-4 space-y-3">
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
        </div>
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
