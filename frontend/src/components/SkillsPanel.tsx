import { useEffect, useState } from "react";
import { skillsApi, Skill, SkillScope } from "../api/skills";
import SkillCreatorChat from "./SkillCreatorChat";

function ScopeBadge({ scope }: { scope: SkillScope }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
      scope === "user" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
    }`}>
      {scope === "user" ? "我的" : "系统"}
    </span>
  );
}

interface Props {
  userId: string;
  onSkillsChanged?: () => void;
}

export default function SkillsPanel({ userId, onSkillsChanged }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreator, setShowCreator] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

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
    setMsg({ type: "ok", text: `已删除 ${skill.name}` });
  };

  if (loading) return <div className="text-sm text-ink-400">加载中…</div>;

  return (
    <div className="space-y-4">
      {msg && (
        <p className={`text-sm px-3 py-2 rounded-lg ${
          msg.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
        }`}>
          {msg.text}
        </p>
      )}

      <div className="space-y-2">
        {skills.length === 0 && (
          <p className="text-sm text-ink-400 text-center py-8 border border-dashed border-ink-200 rounded-xl">
            暂无 Skill
          </p>
        )}
        {skills.map((s) => {
          const scope = s.scope ?? "system";
          return (
            <div key={`${scope}-${s.name}`} className="flex items-center gap-3 border border-ink-200/60 rounded-xl px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <ScopeBadge scope={scope} />
                  <span className="text-sm font-medium text-ink-800">{s.name}</span>
                  {s.hidden && <span className="text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded">隐藏</span>}
                  {(s.tags ?? []).map((t) => (
                    <span key={t} className="text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded">{t}</span>
                  ))}
                </div>
                <p className="text-xs text-ink-400 mt-0.5 truncate">{s.description}</p>
              </div>
              {scope === "system" && (
                <button
                  type="button"
                  onClick={() => handleDelete(s)}
                  className="text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50 shrink-0"
                >
                  删除
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!showCreator ? (
        <button
          type="button"
          onClick={() => {
            if (!userId.trim()) { setMsg({ type: "err", text: "请先在「历史」页设置用户 ID" }); return; }
            setShowCreator(true);
          }}
          className="w-full py-2.5 border-2 border-dashed border-emerald-300/80 text-emerald-700 text-sm rounded-xl hover:bg-emerald-50/50 transition-colors"
        >
          + 创建个人 Skill
        </button>
      ) : (
        <SkillCreatorChat
          userId={userId.trim()}
          scope="user"
          embedded
          onClose={() => setShowCreator(false)}
          onPublished={(skill) => {
            setSkills((prev) => {
              const idx = prev.findIndex((s) => s.name === skill.name && s.scope === "user");
              return idx >= 0 ? prev.map((s, i) => (i === idx ? skill : s)) : [...prev, { ...skill, scope: "user" }];
            });
            setShowCreator(false);
            setMsg({ type: "ok", text: `${skill.name} 已创建，可在对话中输入 / 使用` });
            onSkillsChanged?.();
          }}
        />
      )}
    </div>
  );
}
