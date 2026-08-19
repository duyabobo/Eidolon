import { useEffect, useState } from "react";
import { skillsApi, Skill, SkillScope } from "../api/skills";
import { ConfigActionBtn } from "./config/ConfigActionBtn";
import { ConfigListItem, ScopeBadge } from "./config/ConfigListItem";
import {
  ConfigEmptyState,
  ConfigListPagination,
  ConfigPanelLayout,
} from "./config/ConfigPanelLayout";
import {
  MarketComingSoon,
  MineMarketToolbar,
  type MineMarketTab,
} from "./config/MineMarketTabs";
import { CONFIG_PAGE_SIZE, useClientPagination } from "./config/useClientPagination";
import GitSkillImportModal from "./GitSkillImportModal";
import SkillBrowserModal from "./SkillBrowserModal";
import SkillCreatorChat from "./SkillCreatorChat";

function isGithubSkill(skill: Skill): boolean {
  return (skill.source || "").trim() === "github";
}

interface Props {
  onSkillsChanged?: () => void;
}

export default function SkillsPanel({ onSkillsChanged }: Props) {
  const [tab, setTab] = useState<MineMarketTab>("mine");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreator, setShowCreator] = useState(false);
  const [showGitImport, setShowGitImport] = useState(false);
  const [editSkillName, setEditSkillName] = useState<string | undefined>(undefined);
  const [browseSkill, setBrowseSkill] = useState<Skill | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const load = () =>
    skillsApi
      .listForChat()
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (skill: Skill) => {
    if (!confirm(`确认删除 Skill "${skill.name}"？`)) return;
    try {
      await skillsApi.delete(skill.name, skill.scope === "user" ? "user" : undefined);
      setSkills((prev) => prev.filter((s) => !(s.name === skill.name && s.scope === skill.scope)));
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "删除失败");
    }
  };

  const openCreator = (skillName?: string) => {
    setEditSkillName(skillName);
    setShowCreator(true);
  };

  const pagination = useClientPagination(skills, CONFIG_PAGE_SIZE);

  return (
    <ConfigPanelLayout
      loading={tab === "mine" && loading}
      errMsg={errMsg}
      toolbar={(
        <MineMarketToolbar
          tab={tab}
          onTabChange={setTab}
          addDisabled={showCreator || showGitImport}
          addItems={[
            {
              id: "chat",
              label: "对话创建",
              hint: "结合办事流程和已装插件写成经验",
              onClick: () => openCreator(),
            },
            {
              id: "git",
              label: "从 Git 导入",
              hint: "填写含 SKILL.md 的仓库地址",
              onClick: () => setShowGitImport(true),
            },
          ]}
        />
      )}
      pagination={tab === "mine" ? (
        <ConfigListPagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={pagination.setPage}
        />
      ) : undefined}
    >
      {tab === "market" ? (
        <MarketComingSoon subtitle="经验市场正在规划中，敬请期待" />
      ) : skills.length === 0 ? (
        <ConfigEmptyState message="暂无经验。可对话写成 Skill，或从 Git 地址导入。" />
      ) : (
        <div className="space-y-2">
          {pagination.slice.map((s) => {
            const scope = (s.scope ?? "system") as SkillScope;
            const key = `${scope}-${s.name}`;
            const fromGithub = isGithubSkill(s);
            return (
              <ConfigListItem
                key={key}
                title={s.name}
                meta={(
                  <>
                    <ScopeBadge scope={scope} />
                    {fromGithub && (
                      <span className="text-xs bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded">
                        GitHub
                      </span>
                    )}
                    {s.hidden && (
                      <span className="text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded">
                        隐藏
                      </span>
                    )}
                    {(s.tags ?? []).map((t) => (
                      <span
                        key={t}
                        className="text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded"
                      >
                        {t}
                      </span>
                    ))}
                  </>
                )}
                subtitle={s.description}
                actions={(
                  <>
                    <ConfigActionBtn variant="default" onClick={() => setBrowseSkill(s)}>
                      查看
                    </ConfigActionBtn>
                    {scope === "user" && (
                      <>
                        <ConfigActionBtn variant="default" onClick={() => openCreator(s.name)}>
                          编辑
                        </ConfigActionBtn>
                        <ConfigActionBtn variant="danger" onClick={() => void handleDelete(s)}>
                          删除
                        </ConfigActionBtn>
                      </>
                    )}
                  </>
                )}
              />
            );
          })}
        </div>
      )}

      {showCreator && (
        <SkillCreatorChat
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

      {showGitImport && (
        <GitSkillImportModal
          onClose={() => setShowGitImport(false)}
          onImported={(skill) => {
            const next: Skill = {
              name: skill.name,
              description: skill.description,
              scope: "user",
              source: "github",
              tags: skill.tags,
            };
            setSkills((prev) => {
              const idx = prev.findIndex((s) => s.name === next.name && s.scope === "user");
              return idx >= 0
                ? prev.map((s, i) => (i === idx ? { ...s, ...next } : s))
                : [...prev, next];
            });
            setShowGitImport(false);
            onSkillsChanged?.();
          }}
        />
      )}

      {browseSkill && (
        <SkillBrowserModal
          skillName={browseSkill.name}
          scope={browseSkill.scope === "user" ? "user" : undefined}
          onClose={() => setBrowseSkill(null)}
        />
      )}
    </ConfigPanelLayout>
  );
}
