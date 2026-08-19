"""本机插件的工具清单：落库后列工具不必拉起 stdio 进程。"""
from __future__ import annotations

import logging
from typing import Any

from mcp.types import Tool
from pi_shared.sqlite import dumps, loads

from cm_server.mcp_proxy.services.db import get_db

logger = logging.getLogger(__name__)


def tools_to_payload(tools: list[Tool]) -> list[dict[str, Any]]:
    return [tool.model_dump(by_alias=True, exclude_none=True) for tool in tools]


def tools_from_payload(raw: object) -> dict[str, Tool]:
    items = raw if isinstance(raw, list) else loads(raw, [])
    if not isinstance(items, list):
        return {}
    result: dict[str, Tool] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            tool = Tool.model_validate(item)
        except Exception:
            logger.warning("跳过无法解析的工具清单项 keys=%s", list(item.keys()))
            continue
        result[tool.name] = tool
    return result


async def save_tool_schemas(name: str, user_id: str | None, schemas: list[dict[str, Any]]) -> None:
    payload = dumps(schemas)
    db = get_db()
    if user_id:
        await db.execute(
            "UPDATE mcp_servers SET tool_schemas = ? WHERE name = ? AND user_id = ?",
            (payload, name, user_id),
        )
    else:
        await db.execute(
            "UPDATE mcp_servers SET tool_schemas = ? WHERE name = ? AND user_id IS NULL",
            (payload, name),
        )
    logger.info("已落库插件工具清单 name=%s user=%s count=%d", name, user_id or "-", len(schemas))
