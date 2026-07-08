import { useState, useRef, useCallback, useMemo } from "react";
import { Skill, SkillScope, toSkillRef } from "../api/skills";

interface SlashContext {
  query: string;
  start: number;
}

function detectSlash(input: string, cursorPos: number): SlashContext | null {
  const before = input.slice(0, cursorPos);
  const match = before.match(/(?:^|\s)\/([^\s/]*)$/);
  if (!match) return null;
  return { query: match[1] ?? "", start: before.lastIndexOf("/") };
}

function SkillScopeBadge({ scope }: { scope: SkillScope }) {
  const isUser = scope === "user";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
      isUser ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"
    }`}>
      {isUser ? "我的" : "系统"}
    </span>
  );
}

interface Props {
  skills: Skill[];
  selectedSkillRef: string;
  onSelectSkill: (ref: string) => void;
  onClearSkill: () => void;
  isLoading: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

export default function ChatInput({
  skills, selectedSkillRef, onSelectSkill, onClearSkill,
  isLoading, onSend, onInterrupt,
}: Props) {
  const [input, setInput] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const slashCtx = useMemo(() => detectSlash(input, cursorPos), [input, cursorPos]);
  const menuOpen = slashCtx !== null;

  const filteredSkills = useMemo(() => {
    if (!slashCtx) return [];
    const q = slashCtx.query.toLowerCase();
    return skills.filter((s) => {
      const scope = s.scope ?? "system";
      const ref = toSkillRef(scope, s.name);
      if (selectedSkillRef === ref) return false;
      return !q || s.name.toLowerCase().includes(q);
    });
  }, [slashCtx, skills, selectedSkillRef]);

  const selectedSkill = useMemo(
    () => skills.find((s) => toSkillRef(s.scope ?? "system", s.name) === selectedSkillRef),
    [skills, selectedSkillRef],
  );

  const applySkill = useCallback((skill: Skill) => {
    const scope = skill.scope ?? "system";
    const ref = toSkillRef(scope, skill.name);
    onSelectSkill(ref);
    if (slashCtx) {
      const before = input.slice(0, slashCtx.start);
      const after = input.slice(cursorPos);
      const trimmedBefore = before.replace(/\s$/, "");
      setInput(trimmedBefore + after);
      setCursorPos(trimmedBefore.length);
    }
    setMenuIndex(0);
    textareaRef.current?.focus();
  }, [slashCtx, input, cursorPos, onSelectSkill]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setInput("");
    setMenuIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && filteredSkills.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuIndex((i) => (i + 1) % filteredSkills.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuIndex((i) => (i - 1 + filteredSkills.length) % filteredSkills.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        applySkill(filteredSkills[menuIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (slashCtx) {
          const before = input.slice(0, slashCtx.start);
          const after = input.slice(cursorPos);
          setInput(before + after);
          setCursorPos(before.length);
        }
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const syncCursor = () => {
    const el = textareaRef.current;
    if (el) setCursorPos(el.selectionStart);
  };

  return (
    <div className="relative">
      {menuOpen && filteredSkills.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl border border-ink-200/80 shadow-panel overflow-hidden z-10">
          <p className="text-[11px] text-ink-400 px-3 py-2 border-b border-ink-100">选择 Skill</p>
          <ul className="max-h-48 overflow-y-auto scrollbar-thin py-1">
            {filteredSkills.map((s, i) => {
              const scope = s.scope ?? "system";
              return (
                <li key={toSkillRef(scope, s.name)}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); applySkill(s); }}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                      i === menuIndex ? "bg-brand-50" : "hover:bg-ink-50"
                    }`}
                  >
                    <span className="text-sm font-medium text-ink-800">/{s.name}</span>
                    <SkillScopeBadge scope={scope} />
                    {s.description && (
                      <span className="text-xs text-ink-400 truncate flex-1">{s.description}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selectedSkill && (
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 text-xs bg-brand-50 text-brand-700 border border-brand-200/60 rounded-full px-2.5 py-1">
            <SkillScopeBadge scope={selectedSkill.scope ?? "system"} />
            <span className="font-medium">/{selectedSkill.name}</span>
            <button
              type="button"
              onClick={onClearSkill}
              className="text-brand-400 hover:text-brand-700 ml-0.5"
              aria-label="清除 Skill"
            >
              ×
            </button>
          </span>
        </div>
      )}

      <div className="flex gap-3 items-end rounded-2xl border border-ink-200/80 bg-white/90 p-2 shadow-soft focus-within:ring-2 focus-within:ring-brand-500/20 focus-within:border-brand-300 transition-all duration-200">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setMenuIndex(0); }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCursor}
          onClick={syncCursor}
          onSelect={syncCursor}
          placeholder="输入消息…  输入 / 选择 Skill"
          rows={2}
          disabled={isLoading}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:opacity-60"
        />
        {isLoading ? (
          <button type="button" onClick={onInterrupt} className="ui-btn-danger shrink-0">
            中断
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim()}
            className="ui-btn-primary shrink-0"
          >
            发送
          </button>
        )}
      </div>
    </div>
  );
}
