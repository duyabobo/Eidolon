import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { skillsApi } from "../api/skills";
import SkillCreatorChat from "./SkillCreatorChat";
function ScopeBadge({ scope }) {
    return (_jsx("span", { className: `text-[10px] px-1.5 py-0.5 rounded-full font-medium ${scope === "user" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`, children: scope === "user" ? "我的" : "系统" }));
}
export default function SkillsPanel({ userId, onSkillsChanged }) {
    const [skills, setSkills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreator, setShowCreator] = useState(false);
    const [errMsg, setErrMsg] = useState(null);
    const load = () => skillsApi.listForChat(userId.trim() || undefined)
        .then(setSkills)
        .catch(() => setSkills([]))
        .finally(() => setLoading(false));
    useEffect(() => { load(); }, [userId]);
    const handleDelete = async (skill) => {
        if (skill.scope === "user")
            return;
        if (!confirm(`确认删除系统 Skill "${skill.name}"？`))
            return;
        await skillsApi.delete(skill.name);
        setSkills((prev) => prev.filter((s) => s.name !== skill.name || s.scope === "user"));
    };
    if (loading)
        return _jsx("div", { className: "text-sm text-ink-400", children: "\u52A0\u8F7D\u4E2D\u2026" });
    return (_jsxs("div", { className: "space-y-4", children: [errMsg && (_jsx("p", { className: "text-sm px-3 py-2 rounded-lg bg-rose-50 text-rose-700", children: errMsg })), _jsxs("div", { className: "space-y-2", children: [skills.length === 0 && (_jsx("p", { className: "text-sm text-ink-400 text-center py-8 border border-dashed border-ink-200 rounded-xl", children: "\u6682\u65E0 Skill" })), skills.map((s) => {
                        const scope = s.scope ?? "system";
                        return (_jsxs("div", { className: "flex items-center gap-3 border border-ink-200/60 rounded-xl px-4 py-3", children: [_jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx(ScopeBadge, { scope: scope }), _jsx("span", { className: "text-sm font-medium text-ink-800", children: s.name }), s.hidden && _jsx("span", { className: "text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded", children: "\u9690\u85CF" }), (s.tags ?? []).map((t) => (_jsx("span", { className: "text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded", children: t }, t)))] }), _jsx("p", { className: "text-xs text-ink-400 mt-0.5 truncate", children: s.description })] }), scope === "system" && (_jsx("button", { type: "button", onClick: () => handleDelete(s), className: "text-xs px-3 py-1 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50 shrink-0", children: "\u5220\u9664" }))] }, `${scope}-${s.name}`));
                    })] }), !showCreator ? (_jsx("button", { type: "button", onClick: () => {
                    if (!userId.trim()) {
                        setErrMsg("请先在「历史」页设置用户 ID");
                        return;
                    }
                    setShowCreator(true);
                }, className: "w-full py-2.5 border-2 border-dashed border-emerald-300/80 text-emerald-700 text-sm rounded-xl hover:bg-emerald-50/50 transition-colors", children: "+ \u521B\u5EFA\u4E2A\u4EBA Skill" })) : (_jsx(SkillCreatorChat, { userId: userId.trim(), scope: "user", embedded: true, onClose: () => setShowCreator(false), onPublished: (skill) => {
                    setSkills((prev) => {
                        const idx = prev.findIndex((s) => s.name === skill.name && s.scope === "user");
                        return idx >= 0 ? prev.map((s, i) => (i === idx ? skill : s)) : [...prev, { ...skill, scope: "user" }];
                    });
                    setShowCreator(false);
                    onSkillsChanged?.();
                } }))] }));
}
