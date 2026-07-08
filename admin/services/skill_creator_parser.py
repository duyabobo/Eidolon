import json
import logging
import re
from typing import Any

from models.skill_creator import SkillDraft

logger = logging.getLogger(__name__)

_SKILL_DRAFT_BLOCK = re.compile(
    r"```skill-draft\s*\n(.*?)\n```",
    re.DOTALL | re.IGNORECASE,
)


def _normalize_draft(data: dict[str, Any]) -> SkillDraft | None:
    name = str(data.get("name", "")).strip()
    description = str(data.get("description", "")).strip()
    content = str(data.get("content", "")).strip()
    if not name or not description or not content:
        return None
    raw_tags = data.get("tags") or []
    tags = [str(t).strip() for t in raw_tags if str(t).strip()]
    raw_mcp = data.get("mcp_servers") or []
    mcp_servers = [str(item).strip() for item in raw_mcp if str(item).strip()]
    return SkillDraft(
        name=name,
        description=description,
        content=content,
        tags=tags,
        mcp_servers=mcp_servers,
    )


def extract_skill_draft(text: str) -> SkillDraft | None:
    """从 assistant 回复中解析最新的 skill-draft JSON 块。"""
    matches = list(_SKILL_DRAFT_BLOCK.finditer(text))
    if not matches:
        return None

    for match in reversed(matches):
        raw = match.group(1).strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("skill-draft JSON 解析失败")
            continue
        if not isinstance(data, dict):
            continue
        draft = _normalize_draft(data)
        if draft:
            return draft
    return None


def strip_skill_draft_blocks(text: str) -> str:
    """展示给用户时去掉 skill-draft 块，避免重复 JSON。"""
    cleaned = _SKILL_DRAFT_BLOCK.sub("", text).strip()
    return cleaned or text.strip()
