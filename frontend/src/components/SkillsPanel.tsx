import { useEffect, useState } from "react";
import { skillsApi, Skill } from "../api/skills";
import SkillCreatorChat from "./SkillCreatorChat";

export default function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreator, setShowCreator] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const load = () =>
    skillsApi.listAdmin()
      .then(setSkills)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleDelete = async (name: string) => {
    if (!confirm(`确认删除系统 Skill "${name}"？`)) return;
    await skillsApi.delete(name);
    setSkills((prev) => prev.filter((s) => s.name !== name));
    setMsg({ type: "ok", text: `已删除 ${name}` });
  };

  if (loading) return <div className="text-sm text-gray-400">加载中…</div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
        系统 Skill 仅支持通过 skill-creator 对话创建。保存后元数据写入 MongoDB，正文写入 NFS。
      </p>

      {msg && (
        <p className={`text-sm px-3 py-2 rounded-lg ${
          msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
        }`}>
          {msg.text}
        </p>
      )}

      <div className="space-y-2">
        {skills.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8 border border-dashed border-gray-300 rounded-xl">
            暂无系统 Skill，点击下方按钮通过对话创建
          </p>
        )}
        {skills.map((s) => (
          <div key={s.name} className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded">系统</span>
                <span className="text-sm font-medium text-gray-800">{s.name}</span>
                {s.hidden && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">隐藏</span>}
                {(s.tags ?? []).map((t) => (
                  <span key={t} className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{t}</span>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{s.description}</p>
            </div>
            <button
              onClick={() => handleDelete(s.name)}
              className="text-xs px-3 py-1 border border-red-300 rounded-lg text-red-600 hover:bg-red-50 shrink-0"
            >
              删除
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() => setShowCreator(true)}
        className="w-full px-4 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 transition-colors"
      >
        对话创建系统 Skill
      </button>

      {showCreator && (
        <SkillCreatorChat
          scope="system"
          onClose={() => setShowCreator(false)}
          onPublished={(skill) => {
            setSkills((prev) => {
              const idx = prev.findIndex((s) => s.name === skill.name);
              return idx >= 0 ? prev.map((s, i) => (i === idx ? skill : s)) : [...prev, skill];
            });
            setMsg({ type: "ok", text: `${skill.name} 已通过对话创建并保存` });
          }}
        />
      )}
    </div>
  );
}
