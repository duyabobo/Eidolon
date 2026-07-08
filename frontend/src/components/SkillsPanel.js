import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { skillsApi } from "../api/skills";
import SkillCreatorChat from "./SkillCreatorChat";
export default function SkillsPanel() {
    const [skills, setSkills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreator, setShowCreator] = useState(false);
    const [msg, setMsg] = useState(null);
    const load = () => skillsApi.listAdmin()
        .then(setSkills)
        .catch(() => { })
        .finally(() => setLoading(false));
    useEffect(() => { load(); }, []);
    const handleDelete = async (name) => {
        if (!confirm(`确认删除系统 Skill "${name}"？`))
            return;
        await skillsApi.delete(name);
        setSkills((prev) => prev.filter((s) => s.name !== name));
        setMsg({ type: "ok", text: `已删除 ${name}` });
    };
    if (loading)
        return _jsx("div", { className: "text-sm text-gray-400", children: "\u52A0\u8F7D\u4E2D\u2026" });
    return (_jsxs("div", { className: "space-y-4", children: [_jsx("p", { className: "text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2", children: "\u7CFB\u7EDF Skill \u4EC5\u652F\u6301\u901A\u8FC7 skill-creator \u5BF9\u8BDD\u521B\u5EFA\u3002\u4FDD\u5B58\u540E\u5143\u6570\u636E\u5199\u5165 MongoDB\uFF0C\u6B63\u6587\u5199\u5165 NFS\u3002" }), msg && (_jsx("p", { className: `text-sm px-3 py-2 rounded-lg ${msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`, children: msg.text })), _jsxs("div", { className: "space-y-2", children: [skills.length === 0 && (_jsx("p", { className: "text-sm text-gray-400 text-center py-8 border border-dashed border-gray-300 rounded-xl", children: "\u6682\u65E0\u7CFB\u7EDF Skill\uFF0C\u70B9\u51FB\u4E0B\u65B9\u6309\u94AE\u901A\u8FC7\u5BF9\u8BDD\u521B\u5EFA" })), skills.map((s) => (_jsxs("div", { className: "flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm", children: [_jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xs bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded", children: "\u7CFB\u7EDF" }), _jsx("span", { className: "text-sm font-medium text-gray-800", children: s.name }), s.hidden && _jsx("span", { className: "text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded", children: "\u9690\u85CF" }), (s.tags ?? []).map((t) => (_jsx("span", { className: "text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded", children: t }, t)))] }), _jsx("p", { className: "text-xs text-gray-500 mt-0.5 truncate", children: s.description })] }), _jsx("button", { onClick: () => handleDelete(s.name), className: "text-xs px-3 py-1 border border-red-300 rounded-lg text-red-600 hover:bg-red-50 shrink-0", children: "\u5220\u9664" })] }, s.name)))] }), _jsx("button", { onClick: () => setShowCreator(true), className: "w-full px-4 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 transition-colors", children: "\u5BF9\u8BDD\u521B\u5EFA\u7CFB\u7EDF Skill" }), showCreator && (_jsx(SkillCreatorChat, { scope: "system", onClose: () => setShowCreator(false), onPublished: (skill) => {
                    setSkills((prev) => {
                        const idx = prev.findIndex((s) => s.name === skill.name);
                        return idx >= 0 ? prev.map((s, i) => (i === idx ? skill : s)) : [...prev, skill];
                    });
                    setMsg({ type: "ok", text: `${skill.name} 已通过对话创建并保存` });
                } }))] }));
}
