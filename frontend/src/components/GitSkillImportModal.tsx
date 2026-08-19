import { useState } from "react";
import { skillsApi, type Skill } from "../api/skills";
import { ModalOverlay } from "./config/ModalOverlay";

interface Props {
  onClose: () => void;
  onImported: (skill: Skill) => void;
}

export default function GitSkillImportModal({ onClose, onImported }: Props) {
  const [url, setUrl] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    const githubUrl = url.trim();
    if (!githubUrl) {
      setError("请填写 Git 地址");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const skill = await skillsApi.importFromGithub(githubUrl, overwrite);
      onImported(skill);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay onBackdropClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-ink-200/60">
          <h2 className="font-semibold text-ink-900">从 Git 导入经验</h2>
          <p className="text-xs text-ink-400 mt-0.5">
            填写含 SKILL.md 的 GitHub 仓库地址，可带子目录
          </p>
        </div>
        <div className="px-6 py-4 space-y-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo 或 .../tree/main/skills/foo"
            className="ui-field w-full"
            autoFocus
          />
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            若已存在同名经验则覆盖
          </label>
          {error && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <div className="px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-ink-600 border border-ink-200 rounded-xl">
            取消
          </button>
          <button type="button" onClick={() => void handleImport()} disabled={saving} className="ui-btn-primary">
            {saving ? "导入中…" : "导入"}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
