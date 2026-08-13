import { useCallback, useEffect, useState } from "react";
import {
  knowledgeApi,
  type KnowledgePipelineConfig,
} from "../api/knowledge";
import { ConfigActionBtn, ConfigPrimaryBtn } from "./config/ConfigActionBtn";

const EMPTY_PIPELINE: KnowledgePipelineConfig = {
  mineru3_api_base: "",
  reranker_base_url: "",
  reranker_api_key: "",
  reranker_model_name: "",
};

/**
 * MinerU / Reranker 流水线配置面板（供配置页使用）。
 */
export default function PipelineConfigPanel() {
  const [form, setForm] = useState<KnowledgePipelineConfig>(EMPTY_PIPELINE);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [testingMineru, setTestingMineru] = useState(false);
  const [testingReranker, setTestingReranker] = useState(false);
  const [mineruResult, setMineruResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [rerankerResult, setRerankerResult] = useState<{ ok: boolean; message: string } | null>(null);

  const set = (patch: Partial<KnowledgePipelineConfig>) => setForm((prev) => ({ ...prev, ...patch }));

  const load = useCallback(async () => {
    try {
      const cfg = await knowledgeApi.getPipelineConfig();
      setForm(cfg);
    } catch {
      setForm(EMPTY_PIPELINE);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const formatResult = (ok: boolean, message: string, latencyMs?: number) =>
    ok ? `${message}${latencyMs ? ` · ${latencyMs}ms` : ""}` : (message || "测试失败");

  const handleTestMineru = async () => {
    setTestingMineru(true);
    setMineruResult(null);
    try {
      const result = await knowledgeApi.testMineru(form);
      setMineruResult({ ok: result.ok, message: formatResult(result.ok, result.message, result.latency_ms) });
    } catch (e) {
      setMineruResult({ ok: false, message: e instanceof Error ? e.message : "测试失败" });
    } finally {
      setTestingMineru(false);
    }
  };

  const handleTestReranker = async () => {
    setTestingReranker(true);
    setRerankerResult(null);
    try {
      const result = await knowledgeApi.testReranker(form);
      setRerankerResult({
        ok: result.ok,
        message: formatResult(result.ok, result.message, result.latency_ms),
      });
    } catch (e) {
      setRerankerResult({ ok: false, message: e instanceof Error ? e.message : "测试失败" });
    } finally {
      setTestingReranker(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setErrMsg(null);
    setOkMsg(null);
    try {
      const saved = await knowledgeApi.savePipelineConfig(form);
      setForm(saved);
      setOkMsg("已保存");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-xs text-ink-500">
        文档解析依赖 mineru-api；Reranker 可选。LLM 使用上方已激活的模型配置。
      </p>
      {errMsg && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{errMsg}</p>}
      {okMsg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">{okMsg}</p>}

      <label className="block space-y-1">
        <span className="text-[11px] text-ink-500">mineru-api（必填）</span>
        <div className="flex items-center gap-2">
          <input
            value={form.mineru3_api_base}
            onChange={(e) => {
              setMineruResult(null);
              set({ mineru3_api_base: e.target.value });
            }}
            placeholder="http://127.0.0.1:8000"
            className="ui-field min-w-0 flex-1 text-sm"
          />
          <ConfigActionBtn
            variant="sky"
            className="shrink-0"
            disabled={testingMineru || !form.mineru3_api_base.trim()}
            onClick={() => void handleTestMineru()}
          >
            {testingMineru ? "测试中…" : "测试"}
          </ConfigActionBtn>
        </div>
        {mineruResult && (
          <p className={`text-[11px] ${mineruResult.ok ? "text-emerald-700" : "text-rose-600"}`}>
            {mineruResult.message}
          </p>
        )}
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] text-ink-500">reranker URL（可选）</span>
        <div className="flex items-center gap-2">
          <input
            value={form.reranker_base_url}
            onChange={(e) => {
              setRerankerResult(null);
              set({ reranker_base_url: e.target.value });
            }}
            placeholder="http://..."
            className="ui-field min-w-0 flex-1 text-sm"
          />
          <ConfigActionBtn
            variant="sky"
            className="shrink-0"
            disabled={testingReranker || !form.reranker_base_url.trim()}
            onClick={() => void handleTestReranker()}
          >
            {testingReranker ? "测试中…" : "测试"}
          </ConfigActionBtn>
        </div>
        {rerankerResult && (
          <p className={`text-[11px] ${rerankerResult.ok ? "text-emerald-700" : "text-rose-600"}`}>
            {rerankerResult.message}
          </p>
        )}
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] text-ink-500">reranker API Key</span>
        <input
          value={form.reranker_api_key}
          onChange={(e) => set({ reranker_api_key: e.target.value })}
          placeholder="可选"
          className="ui-field w-full text-sm"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] text-ink-500">reranker Model</span>
        <input
          value={form.reranker_model_name}
          onChange={(e) => set({ reranker_model_name: e.target.value })}
          placeholder="可选"
          className="ui-field w-full text-sm"
        />
      </label>

      <div className="pt-1">
        <ConfigPrimaryBtn
          disabled={saving || !form.mineru3_api_base.trim()}
          onClick={() => void handleSave()}
        >
          {saving ? "保存中…" : "保存解析服务"}
        </ConfigPrimaryBtn>
      </div>
    </div>
  );
}
