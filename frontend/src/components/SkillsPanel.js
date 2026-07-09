import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { skillsApi } from "../api/skills";
import { ConfigActionBtn, ConfigPrimaryBtn } from "./config/ConfigActionBtn";
import { ConfigListItem, ScopeBadge } from "./config/ConfigListItem";
import { ConfigEmptyState, ConfigListToolbar, ConfigPanelLayout, } from "./config/ConfigPanelLayout";
import SkillCreatorChat from "./SkillCreatorChat";
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
    const openCreator = () => {
        if (!userId.trim()) {
            setErrMsg("请先在「历史」页设置用户 ID");
            return;
        }
        setShowCreator(true);
    };
    return (_jsxs(ConfigPanelLayout, { loading: loading, errMsg: errMsg, toolbar: (_jsx(ConfigListToolbar, { left: _jsx("p", { className: "text-xs text-ink-500", children: "\u7CFB\u7EDF Skill \u4E0E\u5F53\u524D\u7528\u6237\u7684\u4E2A\u4EBA Skill" }), right: (_jsx(ConfigPrimaryBtn, { onClick: openCreator, disabled: showCreator, children: "+ \u521B\u5EFA Skill" })) })), children: [skills.length === 0 ? (_jsx(ConfigEmptyState, { message: "\u6682\u65E0 Skill" })) : (_jsx("div", { className: "space-y-2", children: skills.map((s) => {
                    const scope = (s.scope ?? "system");
                    return (_jsx(ConfigListItem, { title: s.name, meta: (_jsxs(_Fragment, { children: [_jsx(ScopeBadge, { scope: scope }), s.hidden && (_jsx("span", { className: "text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded", children: "\u9690\u85CF" })), (s.tags ?? []).map((t) => (_jsx("span", { className: "text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded", children: t }, t)))] })), subtitle: s.description, actions: scope === "system" ? (_jsx(ConfigActionBtn, { variant: "danger", onClick: () => void handleDelete(s), children: "\u5220\u9664" })) : undefined }, `${scope}-${s.name}`));
                }) })), showCreator && (_jsx(SkillCreatorChat, { userId: userId.trim(), scope: "user", embedded: true, onClose: () => setShowCreator(false), onPublished: (skill) => {
                    setSkills((prev) => {
                        const idx = prev.findIndex((s) => s.name === skill.name && s.scope === "user");
                        return idx >= 0 ? prev.map((s, i) => (i === idx ? skill : s)) : [...prev, { ...skill, scope: "user" }];
                    });
                    setShowCreator(false);
                    onSkillsChanged?.();
                } }))] }));
}
