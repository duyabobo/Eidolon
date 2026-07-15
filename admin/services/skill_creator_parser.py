import json
import logging
import re
from typing import Any

from models.skill_creator import SkillDraft

logger = logging.getLogger(__name__)

_SKILL_DRAFT_BLOCK = re.compile(
    r"```skill-draft\s*\n(.*?)\n?```",
    re.DOTALL | re.IGNORECASE,
)
_JSON_BLOCK = re.compile(
    r"```json\s*\n(.*?)\n?```",
    re.DOTALL | re.IGNORECASE,
)


def _looks_like_skill_draft(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    return any(key in data for key in ("name", "description", "content"))


def _merge_tags(base_tags: list[str], raw_tags: Any) -> list[str]:
    if raw_tags is None:
        return list(base_tags)
    return [str(item).strip() for item in raw_tags if str(item).strip()]


def _merge_mcp_servers(base_servers: list[str], raw_servers: Any) -> list[str]:
    if raw_servers is None:
        return list(base_servers)
    return [str(item).strip() for item in raw_servers if str(item).strip()]


def _normalize_draft(data: dict[str, Any], base: SkillDraft | None = None) -> SkillDraft | None:
    """把模型输出的 dict 与已有草稿合并。

    模型只需返回本轮实际变化的字段，未提及的字段（尤其是长篇的 content）
    自动沿用 base——这样可以避免每轮都要求模型重新转义整段 SKILL.md 正文，
    这正是 JSON 解析失败的主要来源。
    """
    base_fields = base.model_dump() if base else {
        "name": "",
        "description": "",
        "content": "",
        "tags": [],
        "mcp_servers": [],
        "mcp_tools_reference": "",
    }

    name = str(data.get("name", base_fields["name"])).strip() or str(base_fields["name"]).strip()
    description = str(data.get("description", base_fields["description"])).strip() or str(base_fields["description"]).strip()
    content = str(data.get("content", base_fields["content"])).strip() or str(base_fields["content"]).strip()
    if not name or not description or not content:
        return None

    return SkillDraft(
        name=name,
        description=description,
        content=content,
        tags=_merge_tags(base_fields["tags"], data.get("tags")),
        mcp_servers=_merge_mcp_servers(base_fields["mcp_servers"], data.get("mcp_servers")),
        mcp_tools_reference=str(data.get("mcp_tools_reference", base_fields["mcp_tools_reference"])).strip(),
    )


def _parse_draft_payload(raw: str, base: SkillDraft | None) -> tuple[SkillDraft | None, str | None]:
    """解析单个 JSON 候选文本，返回 (草稿, 失败原因)；成功时失败原因为 None。"""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, f"JSON 语法错误: {exc}"
    if not _looks_like_skill_draft(data):
        return None, "JSON 不含 name/description/content 任一字段，不是草稿"
    draft = _normalize_draft(data, base)
    if draft is None:
        return None, "合并后 name/description/content 仍有缺失"
    return draft, None


def _extract_from_blocks(
    text: str, pattern: re.Pattern[str], base: SkillDraft | None
) -> tuple[SkillDraft | None, str | None]:
    matches = list(pattern.finditer(text))
    last_error: str | None = None
    for match in reversed(matches):
        draft, error = _parse_draft_payload(match.group(1).strip(), base)
        if draft:
            return draft, None
        last_error = error
    return None, last_error


def extract_skill_draft(text: str, base: SkillDraft | None = None) -> SkillDraft | None:
    """从 assistant 回复中解析最新的 skill-draft JSON 块，并与已有草稿合并。"""
    draft, _ = _extract_from_blocks(text, _SKILL_DRAFT_BLOCK, base)
    if draft:
        return draft
    draft, _ = _extract_from_blocks(text, _JSON_BLOCK, base)
    return draft


def parse_draft_text(text: str, base: SkillDraft | None = None) -> tuple[SkillDraft | None, str | None]:
    """从任意 LLM 文本解析草稿：代码块 → 整段 JSON → 文本中的 JSON 对象。

    返回 (草稿, 最后一次失败原因)；解析成功时失败原因为 None。
    """
    draft, error = _extract_from_blocks(text, _SKILL_DRAFT_BLOCK, base)
    if draft:
        return draft, None

    draft, block_error = _extract_from_blocks(text, _JSON_BLOCK, base)
    if draft:
        return draft, None
    error = block_error or error

    stripped = text.strip()
    if not stripped or stripped.upper() == "SKIP":
        return None, error

    draft, payload_error = _parse_draft_payload(stripped, base)
    if draft:
        return draft, None
    error = payload_error or error

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        draft, brace_error = _parse_draft_payload(stripped[start:end + 1], base)
        if draft:
            return draft, None
        error = brace_error or error

    return None, error


def _is_skill_draft_json(raw: str) -> bool:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return False
    return _looks_like_skill_draft(data)


def strip_skill_draft_blocks(text: str) -> str:
    """展示给用户时去掉 skill-draft / skill 草稿 JSON 块，避免重复 JSON。"""
    cleaned = _SKILL_DRAFT_BLOCK.sub("", text)
    for match in reversed(list(_JSON_BLOCK.finditer(cleaned))):
        if _is_skill_draft_json(match.group(1).strip()):
            cleaned = cleaned[:match.start()] + cleaned[match.end():]
    cleaned = cleaned.strip()
    return cleaned or text.strip()
