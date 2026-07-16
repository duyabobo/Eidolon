import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { skillsApi } from "../api/skills";
import { ConfigActionBtn, ConfigPrimaryBtn } from "./config/ConfigActionBtn";
import { ConfigListItem, ScopeBadge } from "./config/ConfigListItem";
import { ConfigEmptyState, ConfigListPagination, ConfigListToolbar, ConfigPanelLayout, } from "./config/ConfigPanelLayout";
import { CONFIG_PAGE_SIZE, useClientPagination } from "./config/useClientPagination";
import SkillCreatorChat from "./SkillCreatorChat";
function SkillContentPanel({ name, userId }) {
    const [content, setContent] = useState(null);
    const [err, setErr] = useState(false);
    useEffect(() => {
        setContent(null);
        setErr(false);
        skillsApi.getContent(name, userId || undefined)
            .then((r) => setContent(r.raw))
            .catch(() => setErr(true));
    }, [name, userId]);
    if (err)
        return _jsx("p", { className: "text-xs text-red-400 mt-2", children: "\u52A0\u8F7D\u5931\u8D25" });
    if (content === null)
        return _jsx("p", { className: "text-xs text-ink-400 mt-2 animate-pulse", children: "\u52A0\u8F7D\u4E2D\u2026" });
    return (_jsx("pre", { className: "mt-2 text-xs text-ink-700 bg-ink-50 rounded-lg p-3 overflow-auto max-h-60 whitespace-pre-wrap break-words leading-relaxed border border-ink-200/60", children: content }));
}
export default function SkillsPanel({ userId, onSkillsChanged }) {
    const [skills, setSkills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreator, setShowCreator] = useState(false);
    const [editSkillName, setEditSkillName] = useState(undefined);
    const [expandedSkill, setExpandedSkill] = useState(null);
    const [errMsg, setErrMsg] = useState(null);
    const load = () => skillsApi.listForChat(userId.trim() || undefined)
        .then(setSkills)
        .catch(() => setSkills([]))
        .finally(() => setLoading(false));
    useEffect(() => { load(); }, [userId]);
    const handleDelete = async (skill) => {
        if (!confirm(`确认删除 Skill "${skill.name}"？`))
            return;
        const uid = skill.scope === "user" ? userId.trim() : undefined;
        await skillsApi.delete(skill.name, uid);
        setSkills((prev) => prev.filter((s) => !(s.name === skill.name && s.scope === skill.scope)));
    };
    const openCreator = (skillName) => {
        if (!userId.trim()) {
            setErrMsg("请先在右上角「历史」中设置用户 ID");
            return;
        }
        setEditSkillName(skillName);
        setShowCreator(true);
    };
    const pagination = useClientPagination(skills, CONFIG_PAGE_SIZE);
    return (_jsxs(ConfigPanelLayout, { loading: loading, errMsg: errMsg, toolbar: (_jsx(ConfigListToolbar, { left: _jsx("p", { className: "text-xs text-ink-500", children: "\u7CFB\u7EDF Skill \u4E0E\u5F53\u524D\u7528\u6237\u7684\u4E2A\u4EBA Skill" }), right: (_jsx(ConfigPrimaryBtn, { onClick: () => openCreator(), disabled: showCreator, children: "\u6DFB\u52A0" })) })), pagination: (_jsx(ConfigListPagination, { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total, onPageChange: pagination.setPage })), children: [skills.length === 0 ? (_jsx(ConfigEmptyState, { message: "\u6682\u65E0 Skill" })) : (_jsx("div", { className: "space-y-2", children: pagination.slice.map((s) => {
                    const scope = (s.scope ?? "system");
                    return (_jsx(ConfigListItem, { title: s.name, meta: (_jsxs(_Fragment, { children: [_jsx(ScopeBadge, { scope: scope }), s.hidden && (_jsx("span", { className: "text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded", children: "\u9690\u85CF" })), (s.tags ?? []).map((t) => (_jsx("span", { className: "text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded", children: t }, t)))] })), subtitle: s.description, extra: expandedSkill === `${scope}-${s.name}` && (_jsx(SkillContentPanel, { name: s.name, userId: scope === "user" ? userId : "" })), actions: (_jsxs(_Fragment, { children: [_jsx(ConfigActionBtn, { variant: "default", onClick: () => setExpandedSkill(expandedSkill === `${scope}-${s.name}` ? null : `${scope}-${s.name}`), children: expandedSkill === `${scope}-${s.name}` ? "收起" : "查看" }), scope === "user" && (_jsxs(_Fragment, { children: [_jsx(ConfigActionBtn, { variant: "default", onClick: () => openCreator(s.name), children: "\u7F16\u8F91" }), _jsx(ConfigActionBtn, { variant: "danger", onClick: () => void handleDelete(s), children: "\u5220\u9664" })] }))] })) }, `${scope}-${s.name}`));
                }) })), showCreator && (_jsx(SkillCreatorChat, { userId: userId.trim(), scope: "user", embedded: true, editSkillName: editSkillName, onClose: () => {
                    setShowCreator(false);
                    setEditSkillName(undefined);
                }, onPublished: (skill) => {
                    setSkills((prev) => {
                        const idx = prev.findIndex((s) => s.name === skill.name && s.scope === "user");
                        return idx >= 0 ? prev.map((s, i) => (i === idx ? skill : s)) : [...prev, { ...skill, scope: "user" }];
                    });
                    setShowCreator(false);
                    setEditSkillName(undefined);
                    onSkillsChanged?.();
                } }))] }));
}
