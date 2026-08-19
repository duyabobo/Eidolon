"""从对话回复里解析插件草稿：优先 ```json plugin-draft，其次 ```python。"""
from __future__ import annotations

import json
import logging
import re

from cm_server.admin.models.plugin_creator import PluginDraft

logger = logging.getLogger(__name__)

_JSON_BLOCK = re.compile(r"```json\s*\n(.*?)\n?```", re.DOTALL | re.IGNORECASE)
_PY_BLOCK = re.compile(r"```(?:python|py)\s*\n(.*?)\n?```", re.DOTALL | re.IGNORECASE)
_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,63}$")


def _looks_like_draft(data: dict) -> bool:
    return "name" in data or "description" in data or "server_py" in data


def _normalize(data: dict, base: PluginDraft | None) -> PluginDraft | None:
    prev = base.model_dump() if base else {"name": "", "description": "", "server_py": ""}
    name = str(data.get("name", prev["name"])).strip() or str(prev["name"]).strip()
    description = str(data.get("description", prev["description"])).strip() or str(prev["description"]).strip()
    server_py = str(data.get("server_py", prev["server_py"])).strip() or str(prev["server_py"]).strip()
    if not name or not description or not server_py:
        return None
    if not _NAME_RE.match(name):
        logger.info("插件名不合法 name=%s", name)
        return None
    return PluginDraft(name=name, description=description, server_py=server_py)


def extract_plugin_draft(text: str, base: PluginDraft | None = None) -> PluginDraft | None:
    for match in reversed(list(_JSON_BLOCK.finditer(text or ""))):
        try:
            data = json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and _looks_like_draft(data):
            draft = _normalize(data, base)
            if draft:
                return draft
    py_match = list(_PY_BLOCK.finditer(text or ""))
    if py_match and base is not None:
        server_py = py_match[-1].group(1).strip()
        if server_py:
            return _normalize({"server_py": server_py}, base)
    return None


def strip_plugin_draft_blocks(text: str) -> str:
    cleaned = _JSON_BLOCK.sub("", text or "")
    cleaned = cleaned.strip()
    return cleaned or (text or "").strip()
