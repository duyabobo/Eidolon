import { useEffect, useState } from "react";
import { skillsApi, Skill, SkillScope } from "../api/skills";
import { ConfigActionBtn, ConfigPrimaryBtn } from "./config/ConfigActionBtn";
import { ConfigListItem, ScopeBadge } from "./config/ConfigListItem";
import {
  ConfigEmptyState,
  ConfigListPagination,
  ConfigListToolbar,
  ConfigPanelLayout,
} from "./config/ConfigPanelLayout";
import { CONFIG_PAGE_SIZE, useClientPagination } from "./config/useClientPagination";
import SkillCreatorChat from "./SkillCreatorChat";

interface Props {
  userId: string;
  onSkillsChanged?: () => void;
}

export default function SkillsPanel({ userId, onSkillsChanged }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreator, setShowCreator] = useState(false);
  const [editSkillName, setEditSkillName] = useState<string | undefined>(undefined);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const load = () =>
    skillsApi.listForChat(userId.trim() || undefined)
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, [userId]);

  const handleDelete = async (skill: Skill) => {
    if (skill.scope === "user") return;
    if (!confirm(`确认删除系统 Skill "${skill.name}"？`)) return;
    await skillsApi.delete(skill.name);
    setSkills((prev) => prev.filter((s) => s.name !== skill.name || s.scope === "user"));
  };

  const openCreator = (skillName?: string) => {
    if (!userId.trim()) {
      setErrMsg("请先在「历史」页设置用户 ID");
      return;
    }
    setEditSkillName(skillName);
    setShowCreator(true);
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
            <ConfigPrimaryBtn onClick={() => openCreator()} disabled={showCreator}>
              添加
            </ConfigPrimaryBtn>
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
            return (
              <ConfigListItem
                key={`${scope}-${s.name}`}
                title={s.name}
                meta={(
                  <>
                    <ScopeBadge scope={scope} />
                    {s.hidden && (
                      <span className="text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded">隐藏</span>
                    )}
                    {(s.tags ?? []).map((t) => (
                      <span key={t} className="text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                  </>
                )}
                subtitle={s.description}
                actions={
                  scope === "user" ? (
                    <ConfigActionBtn variant="default" onClick={() => openCreator(s.name)}>
                      编辑
                    </ConfigActionBtn>
                  ) : (
                    <ConfigActionBtn variant="danger" onClick={() => void handleDelete(s)}>
                      删除
                    </ConfigActionBtn>
                  )
                }
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
              const idx = prev.findIndex((s) => s.name === skill.name && s.scope === "user");
              return idx >= 0 ? prev.map((s, i) => (i === idx ? skill : s)) : [...prev, { ...skill, scope: "user" }];
            });
            setShowCreator(false);
            setEditSkillName(undefined);
            onSkillsChanged?.();
          }}
        />
      )}
    </ConfigPanelLayout>
  );
}
