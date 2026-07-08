import { useCallback, useEffect, useState } from "react";
import { configApi, LlmProfile, LlmProfileCreate } from "../api/config";

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

export default function LlmConfigPanel() {
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await configApi.listLlmProfiles();
      setProfiles(res.items);
      setActiveId(res.active_id);
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

  const openCreate = () => {
    setModal({ mode: "create", form: { ...EMPTY_FORM, name: `配置 ${profiles.length + 1}` } });
  };

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

  if (loading) return <p className="text-sm text-ink-400">加载 LLM 配置…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-600">选择当前生效的 LLM 配置（单选）</p>
        <button type="button" onClick={openCreate} className="ui-btn-primary text-sm">
          + 添加
        </button>
      </div>

      {profiles.length === 0 ? (
        <p className="text-sm text-ink-400 text-center py-8 border border-dashed border-ink-200 rounded-xl">
          暂无 LLM 配置，点击「添加」创建
        </p>
      ) : (
        <div className="space-y-2">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className={`flex items-center gap-3 border rounded-xl px-4 py-3 ${
                activeId === profile.id ? "border-brand-300 bg-brand-50/40" : "border-ink-200/60"
              }`}
            >
              <input
                type="radio"
                name="llm-profile"
                checked={activeId === profile.id}
                onChange={() => void handleSelect(profile.id)}
                className="accent-brand-600"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-800 truncate">{profile.name}</p>
                <p className="text-xs text-ink-400 truncate">
                  {profile.protocol} · {profile.model} · {profile.base_url}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => openEdit(profile)}
                  className="text-xs px-3 py-1 border border-ink-200 rounded-lg text-ink-600 hover:bg-ink-50"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(profile)}
                  disabled={profiles.length <= 1}
                  className="text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {errMsg && (
        <p className="text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700">
          {errMsg}
        </p>
      )}

      {modal && (
        <LlmProfileModal
          modal={modal}
          saving={saving}
          onChange={(form) => setModal({ ...modal, form })}
          onSave={() => void handleModalSave()}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
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
    <div className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-ink-200/60">
          <h2 className="font-semibold text-ink-900">
            {modal.mode === "create" ? "添加 LLM 配置" : `编辑 · ${modal.profile.name}`}
          </h2>
        </div>
        <div className="px-6 py-4 space-y-3">
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
        <div className="px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2">
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
    </div>
  );
}
