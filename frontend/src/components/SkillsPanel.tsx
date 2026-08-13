import { useCallback, useEffect, useState } from "react";
import { skillsApi, Skill, SkillScope } from "../api/skills";
import { ConfigActionBtn, ConfigPrimaryBtn, ConfigToolbarBtn } from "./config/ConfigActionBtn";
import { ConfigListItem, ScopeBadge } from "./config/ConfigListItem";
import {
  ConfigEmptyState,
  ConfigListPagination,
  ConfigListToolbar,
  ConfigPanelLayout,
} from "./config/ConfigPanelLayout";
import { CONFIG_PAGE_SIZE, useClientPagination } from "./config/useClientPagination";
import FilePreviewModal, { type FilePreviewSource } from "./FilePreviewModal";
import SkillCreatorChat from "./SkillCreatorChat";
import SkillFolderTree from "./SkillFolderTree";

function isGithubSkill(skill: Skill): boolean {
  return (skill.source || "").trim() === "github";
}

interface Props {
  userId: string;
  onSkillsChanged?: () => void;
}

export default function SkillsPanel({ userId, onSkillsChanged }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreator, setShowCreator] = useState(false);
  const [editSkillName, setEditSkillName] = useState<string | undefined>(undefined);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [showGithub, setShowGithub] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubRef, setGithubRef] = useState("");
  const [githubSubdir, setGithubSubdir] = useState("");
  const [githubOverwrite, setGithubOverwrite] = useState(false);
  const [githubBusy, setGithubBusy] = useState(false);
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);

  const load = () =>
    skillsApi
      .listForChat(userId.trim() || undefined)
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, [userId]);

  const handleDelete = async (skill: Skill) => {
    if (!confirm(`确认删除 Skill "${skill.name}"？`)) return;
    const uid = skill.scope === "user" ? userId.trim() : undefined;
    await skillsApi.delete(skill.name, uid);
    setSkills((prev) => prev.filter((s) => !(s.name === skill.name && s.scope === skill.scope)));
  };

  const openCreator = (skillName?: string) => {
    if (!userId.trim()) {
      setErrMsg("请先在配置页设置用户 ID");
      return;
    }
    setEditSkillName(skillName);
    setShowCreator(true);
  };

  const resetGithubForm = () => {
    setGithubUrl("");
    setGithubRef("");
    setGithubSubdir("");
    setGithubOverwrite(false);
  };

  const closeGithubImport = () => {
    if (githubBusy) return;
    setShowGithub(false);
    resetGithubForm();
    setErrMsg(null);
  };

  const openGithubImport = () => {
    if (!userId.trim()) {
      setErrMsg("请先在配置页设置用户 ID");
      return;
    }
    setErrMsg(null);
    resetGithubForm();
    setShowGithub(true);
  };

  const handleGithubImport = async () => {
    const url = githubUrl.trim();
    if (!url) {
      setErrMsg("请填写 GitHub 仓库地址");
      return;
    }
    setGithubBusy(true);
    setErrMsg(null);
    try {
      const result = await skillsApi.importFromGithub({
        github_url: url,
        user_id: userId.trim(),
        ref: githubRef.trim() || undefined,
        subdir: githubSubdir.trim() || undefined,
        overwrite: githubOverwrite,
      });
      setSkills((prev) => {
        const next: Skill = {
          name: result.name,
          description: result.description,
          scope: "user",
          tags: [],
          source: "github",
        };
        const idx = prev.findIndex((s) => s.name === result.name && s.scope === "user");
        return idx >= 0 ? prev.map((s, i) => (i === idx ? next : s)) : [...prev, next];
      });
      setShowGithub(false);
      resetGithubForm();
      setExpandedSkill(`user-${result.name}`);
      onSkillsChanged?.();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "导入失败");
    } finally {
      setGithubBusy(false);
    }
  };

  const pagination = useClientPagination(skills, CONFIG_PAGE_SIZE);

  return (
    <ConfigPanelLayout
      loading={loading}
      errMsg={errMsg}
      toolbar={(
        <ConfigListToolbar
          left={<p className="text-xs text-ink-500">系统 Skill 与当前用户的个人 Skill</p>}
          right={(
            <>
              <ConfigToolbarBtn onClick={openGithubImport} disabled={showCreator}>
                从 GitHub 导入
              </ConfigToolbarBtn>
              <ConfigPrimaryBtn onClick={() => openCreator()} disabled={showCreator}>
                添加
              </ConfigPrimaryBtn>
            </>
          )}
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
      {skills.length === 0 ? (
        <ConfigEmptyState message="暂无 Skill" />
      ) : (
        <div className="space-y-2">
          {pagination.slice.map((s) => {
            const scope = (s.scope ?? "system") as SkillScope;
            const key = `${scope}-${s.name}`;
            const fromGithub = isGithubSkill(s);
            const skillUserId = scope === "user" ? userId.trim() : undefined;
            return (
              <SkillListRow
                key={key}
                skill={s}
                scope={scope}
                itemKey={key}
                expanded={expandedSkill === key}
                fromGithub={fromGithub}
                skillUserId={skillUserId}
                onToggleExpand={() => setExpandedSkill(expandedSkill === key ? null : key)}
                onPreview={(path, filename) =>
                  setPreview({
                    type: "skill",
                    skillName: s.name,
                    path,
                    filename,
                    userId: skillUserId,
                  })
                }
                onEdit={() => openCreator(s.name)}
                onDelete={() => void handleDelete(s)}
              />
            );
          })}
        </div>
      )}

      {showCreator && (
        <SkillCreatorChat
          userId={userId.trim()}
          scope="user"
          embedded
          editSkillName={editSkillName}
          onClose={() => {
            setShowCreator(false);
            setEditSkillName(undefined);
          }}
          onPublished={(skill) => {
            setSkills((prev) => {
              const next = { ...skill, source: "" };
              const idx = prev.findIndex((s) => s.name === skill.name && s.scope === "user");
              return idx >= 0
                ? prev.map((s, i) => (i === idx ? next : s))
                : [...prev, { ...next, scope: "user" as const }];
            });
            setShowCreator(false);
            setEditSkillName(undefined);
            onSkillsChanged?.();
          }}
        />
      )}

      {preview && (
        <FilePreviewModal
          source={preview}
          subtitle={preview.type === "skill" ? `skill: ${preview.skillName}` : undefined}
          onClose={() => setPreview(null)}
        />
      )}

      {showGithub && (
        <GithubImportModal
          busy={githubBusy}
          errMsg={errMsg}
          githubUrl={githubUrl}
          githubRef={githubRef}
          githubSubdir={githubSubdir}
          githubOverwrite={githubOverwrite}
          onUrlChange={setGithubUrl}
          onRefChange={setGithubRef}
          onSubdirChange={setGithubSubdir}
          onOverwriteChange={setGithubOverwrite}
          onImport={() => void handleGithubImport()}
          onCancel={closeGithubImport}
        />
      )}
    </ConfigPanelLayout>
  );
}

function GithubImportModal({
  busy,
  errMsg,
  githubUrl,
  githubRef,
  githubSubdir,
  githubOverwrite,
  onUrlChange,
  onRefChange,
  onSubdirChange,
  onOverwriteChange,
  onImport,
  onCancel,
}: {
  busy: boolean;
  errMsg: string | null;
  githubUrl: string;
  githubRef: string;
  githubSubdir: string;
  githubOverwrite: boolean;
  onUrlChange: (v: string) => void;
  onRefChange: (v: string) => void;
  onSubdirChange: (v: string) => void;
  onOverwriteChange: (v: boolean) => void;
  onImport: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-ink-900/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-panel w-full max-w-lg border border-ink-200/60">
        <div className="px-6 py-4 border-b border-ink-200/60">
          <h2 className="font-semibold text-ink-900">从 GitHub 导入</h2>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-xs text-ink-600">
            导入完整 Skill 目录（SKILL.md 及 scripts / references / assets 等）；导入后可查看，不支持对话编辑
          </p>
          {errMsg && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{errMsg}</p>
          )}
          <input
            className="ui-field w-full"
            placeholder="https://github.com/owner/repo 或 .../tree/main/path/to/skill"
            value={githubUrl}
            onChange={(e) => onUrlChange(e.target.value)}
            autoFocus
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2">
            <input
              className="ui-field flex-1 min-w-[120px]"
              placeholder="分支/标签（可选，默认 main）"
              value={githubRef}
              onChange={(e) => onRefChange(e.target.value)}
              disabled={busy}
            />
            <input
              className="ui-field flex-1 min-w-[120px]"
              placeholder="子目录（可选）"
              value={githubSubdir}
              onChange={(e) => onSubdirChange(e.target.value)}
              disabled={busy}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={githubOverwrite}
              onChange={(e) => onOverwriteChange(e.target.checked)}
              disabled={busy}
            />
            若同名已存在则覆盖
          </label>
        </div>
        <div className="px-6 py-4 border-t border-ink-200/60 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm border border-ink-200 rounded-xl"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || !githubUrl.trim()}
            onClick={onImport}
            className="ui-btn-primary"
          >
            {busy ? "导入中…" : "导入"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SkillListRow({
  skill,
  scope,
  itemKey,
  expanded,
  fromGithub,
  skillUserId,
  onToggleExpand,
  onPreview,
  onEdit,
  onDelete,
}: {
  skill: Skill;
  scope: SkillScope;
  itemKey: string;
  expanded: boolean;
  fromGithub: boolean;
  skillUserId?: string;
  onToggleExpand: () => void;
  onPreview: (path: string, filename: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const loadEntries = useCallback(
    () => skillsApi.getTree(skill.name, skillUserId).then((r) => r.entries),
    [skill.name, skillUserId],
  );

  return (
    <ConfigListItem
      key={itemKey}
      title={skill.name}
      meta={(
        <>
          <ScopeBadge scope={scope} />
          {fromGithub && (
            <span className="text-xs bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded">GitHub</span>
          )}
          {skill.hidden && (
            <span className="text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded">隐藏</span>
          )}
          {(skill.tags ?? []).map((t) => (
            <span key={t} className="text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded">{t}</span>
          ))}
        </>
      )}
      subtitle={skill.description}
      extra={expanded && (
        <div className="mt-2">
          <SkillFolderTree loadEntries={loadEntries} onPreview={onPreview} />
        </div>
      )}
      actions={(
        <>
          <ConfigActionBtn variant="default" onClick={onToggleExpand}>
            {expanded ? "收起" : "查看"}
          </ConfigActionBtn>
          {scope === "user" && (
            <>
              {!fromGithub && (
                <ConfigActionBtn variant="default" onClick={onEdit}>
                  编辑
                </ConfigActionBtn>
              )}
              <ConfigActionBtn variant="danger" onClick={onDelete}>
                删除
              </ConfigActionBtn>
            </>
          )}
        </>
      )}
    />
  );
}
