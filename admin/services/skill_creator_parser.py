"""
Skill 草稿解析：以完整 SKILL.md（YAML frontmatter + Markdown 正文）为主。

不再依赖把长正文塞进 JSON 字符串——那是 draft-sync 反复失败的根因。
仍兼容历史 skill-draft / json 块，便于旧会话过渡。
"""
import json
import logging
import re
from typing import Any

from models.skill_creator import SkillDraft

logger = logging.getLogger(__name__)

_SKILL_MD_BLOCK = re.compile(
    r"```(?:skill-draft|skill\.md|markdown|md)\s*\n(.*?)\n?```",
    re.DOTALL | re.IGNORECASE,
)
_JSON_BLOCK = re.compile(
    r"```json\s*\n(.*?)\n?```",
    re.DOTALL | re.IGNORECASE,
)
_FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?(.*)\Z", re.DOTALL)
_LIST_ITEM = re.compile(r"^\s*-\s+(.*)$")
_KEY_VALUE = re.compile(r"^([A-Za-z0-9_]+)\s*:\s*(.*)$")


def _unquote(value: str) -> str:
    text = value.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    return text


def _parse_frontmatter(fm: str) -> dict[str, Any]:
    """解析 Skill 常用的简单 YAML frontmatter（标量 + 字符串列表）。"""
    result: dict[str, Any] = {}
    current_list_key: str | None = None

    for raw_line in fm.splitlines():
        line = raw_line.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue

        list_match = _LIST_ITEM.match(line)
        if list_match and current_list_key:
            items = result.setdefault(current_list_key, [])
            if isinstance(items, list):
                items.append(_unquote(list_match.group(1)))
            continue

        kv = _KEY_VALUE.match(line)
        if not kv:
            current_list_key = None
            continue

        key, val = kv.group(1), kv.group(2).strip()
        if val == "":
            result[key] = []
            current_list_key = key
            continue

        current_list_key = None
        result[key] = _unquote(val)

    return result


def _strip_wrapping_fence(text: str) -> str:
    stripped = text.strip()
    fence = re.match(r"^```(?:[^\n]*)\n([\s\S]*?)\n```$", stripped)
    if fence:
        return fence.group(1).strip()
    return stripped


def parse_skill_markdown(text: str) -> dict[str, Any] | None:
    """解析完整 SKILL.md；成功返回 dict（含 content），否则 None。"""
    body_source = _strip_wrapping_fence(text)
    if not body_source or body_source.upper() == "SKIP":
        return None

    match = _FRONTMATTER.match(body_source)
    if not match:
        return {"content": body_source.strip()}

    data = _parse_frontmatter(match.group(1))
    data["content"] = match.group(2).strip()
    return data


def build_skill_markdown(draft: SkillDraft) -> str:
    """把结构化草稿拼成完整 SKILL.md，供预览与 draft-sync 上下文。"""
    lines = ["---", f"name: {draft.name}", f"description: {draft.description}"]
    if draft.tags:
        lines.append("tags:")
        lines.extend(f"  - {item}" for item in draft.tags)
    if draft.mcp_tools:
        lines.append("mcp_tools:")
        lines.extend(f"  - {item}" for item in draft.mcp_tools)
    lines.extend(["---", "", draft.content.strip(), ""])
    return "\n".join(lines)


def _looks_like_meta(data: dict[str, Any]) -> bool:
    return "name" in data or "description" in data or "mcp_tools" in data


def _merge_string_list(base_list: list[str], raw_list: Any) -> list[str]:
    if raw_list is None:
        return list(base_list)
    if isinstance(raw_list, str):
        return [raw_list.strip()] if raw_list.strip() else []
    return [str(item).strip() for item in raw_list if str(item).strip()]


def _normalize_draft(data: dict[str, Any], base: SkillDraft | None = None) -> SkillDraft | None:
    base_fields = base.model_dump() if base else {
        "name": "",
        "description": "",
        "content": "",
        "tags": [],
        "mcp_tools": [],
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
        tags=_merge_string_list(base_fields["tags"], data.get("tags")),
        mcp_tools=_merge_string_list(base_fields["mcp_tools"], data.get("mcp_tools")),
        mcp_tools_reference=str(data.get("mcp_tools_reference", base_fields["mcp_tools_reference"])).strip(),
    )


def _parse_markdown_candidate(raw: str, base: SkillDraft | None) -> tuple[SkillDraft | None, str | None]:
    data = parse_skill_markdown(raw)
    if data is None:
        return None, None

    content_only = not _looks_like_meta(data)
    if content_only and base is None:
        return None, "不是完整 SKILL.md（缺 frontmatter）"
    if content_only and base is not None:
        draft = _normalize_draft({"content": data.get("content", "")}, base)
        if draft is None:
            return None, "合并后 name/description/content 仍有缺失"
        return draft, None

    draft = _normalize_draft(data, base)
    if draft is None:
        return None, "合并后 name/description/content 仍有缺失"
    return draft, None


def _parse_json_candidate(raw: str, base: SkillDraft | None) -> tuple[SkillDraft | None, str | None]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, f"JSON 语法错误: {exc}"
    if not isinstance(data, dict) or not (
        "name" in data or "description" in data or "content" in data
    ):
        return None, "JSON 不含 name/description/content 任一字段，不是草稿"
    draft = _normalize_draft(data, base)
    if draft is None:
        return None, "合并后 name/description/content 仍有缺失"
    return draft, None


def _extract_from_blocks(
    text: str,
    pattern: re.Pattern[str],
    base: SkillDraft | None,
    parser,
) -> tuple[SkillDraft | None, str | None]:
    last_error: str | None = None
    for match in reversed(list(pattern.finditer(text))):
        draft, error = parser(match.group(1).strip(), base)
        if draft:
            return draft, None
        last_error = error
    return None, last_error


def extract_skill_draft(text: str, base: SkillDraft | None = None) -> SkillDraft | None:
    """从 assistant 回复中解析草稿（优先 SKILL.md 代码块）。"""
    draft, _ = _extract_from_blocks(text, _SKILL_MD_BLOCK, base, _parse_markdown_candidate)
    if draft:
        return draft
    draft, _ = _parse_markdown_candidate(text, base)
    if draft and parse_skill_markdown(text) and _looks_like_meta(parse_skill_markdown(text) or {}):
        return draft
    draft, _ = _extract_from_blocks(text, _JSON_BLOCK, base, _parse_json_candidate)
    return draft


def parse_draft_text(text: str, base: SkillDraft | None = None) -> tuple[SkillDraft | None, str | None]:
    """解析 LLM 草稿输出：SKILL.md → 代码块 → 旧 JSON。"""
    stripped = text.strip()
    if not stripped or stripped.upper() == "SKIP":
        return None, None

    draft, error = _parse_markdown_candidate(stripped, base)
    if draft:
        return draft, None

    draft, block_error = _extract_from_blocks(stripped, _SKILL_MD_BLOCK, base, _parse_markdown_candidate)
    if draft:
        return draft, None
    error = block_error or error

    fm_start = stripped.find("---\n")
    if fm_start < 0:
        fm_start = stripped.find("---\r\n")
    if fm_start >= 0:
        draft, sliced_error = _parse_markdown_candidate(stripped[fm_start:], base)
        if draft:
            return draft, None
        error = sliced_error or error

    draft, json_block_error = _extract_from_blocks(stripped, _JSON_BLOCK, base, _parse_json_candidate)
    if draft:
        logger.info("skill-creator parser: 回退解析旧 JSON 草稿块")
        return draft, None
    error = json_block_error or error

    if stripped.startswith("{"):
        draft, payload_error = _parse_json_candidate(stripped, base)
        if draft:
            logger.info("skill-creator parser: 回退解析旧 JSON 对象")
            return draft, None
        error = payload_error or error

    return None, error or "无法识别为 SKILL.md 或草稿 JSON"


def _is_skill_draft_json(raw: str) -> bool:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return False
    return isinstance(data, dict) and (
        "name" in data or "description" in data or "content" in data
    )


def strip_skill_draft_blocks(text: str) -> str:
    """展示给用户时去掉草稿代码块，避免重复。"""
    cleaned = _SKILL_MD_BLOCK.sub("", text)
    for match in reversed(list(_JSON_BLOCK.finditer(cleaned))):
        if _is_skill_draft_json(match.group(1).strip()):
            cleaned = cleaned[: match.start()] + cleaned[match.end() :]
    cleaned = cleaned.strip()
    return cleaned or text.strip()
