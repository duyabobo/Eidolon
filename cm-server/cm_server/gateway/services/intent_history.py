"""从 session 事件里抽出最近几轮问答，供意图路由消歧 / 代词还原。"""
from __future__ import annotations

_HISTORY_TURNS = 4
_TURN_CHARS = 280
_USER_EVENTS = frozenset({"user_message"})
_ASSISTANT_EVENTS = frozenset({"token", "final_result"})


def _clip(text: str) -> str:
    raw = " ".join((text or "").split())
    if len(raw) <= _TURN_CHARS:
        return raw
    return raw[:_TURN_CHARS] + "…"


def extract_recent_turns(events: list[dict] | None) -> list[tuple[str, str]]:
    """返回 [(user, assistant), ...]，时间正序，最多最近 _HISTORY_TURNS 轮。"""
    turns: list[tuple[str, str]] = []
    user = ""
    assistant_parts: list[str] = []

    def flush() -> None:
        nonlocal user, assistant_parts
        if not user:
            assistant_parts = []
            return
        turns.append((user, "".join(assistant_parts)))
        user = ""
        assistant_parts = []

    for event in events or []:
        kind = str(event.get("event_type") or "")
        content = str(event.get("content") or "")
        if kind in _USER_EVENTS:
            flush()
            user = content
            continue
        if kind in _ASSISTANT_EVENTS and user:
            assistant_parts.append(content)

    flush()
    recent = turns[-_HISTORY_TURNS:]
    return [(_clip(q), _clip(a)) for q, a in recent]


def format_recent_turns(turns: list[tuple[str, str]]) -> str:
    if not turns:
        return "（无历史）"
    lines: list[str] = []
    for index, (question, answer) in enumerate(turns, start=1):
        lines.append(f"Q{index}: {question or '（空）'}")
        lines.append(f"A{index}: {answer or '（尚未回答）'}")
    return "\n".join(lines)
