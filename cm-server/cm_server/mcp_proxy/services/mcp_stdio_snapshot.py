"""发布本机插件时拉一次 tool list，立刻退出进程，供之后懒加载列工具。"""
from __future__ import annotations

import logging
from contextlib import AsyncExitStack

from cm_server.mcp_proxy.services.mcp_connection import open_stdio_session
from cm_server.mcp_proxy.services.mcp_tool_catalog import save_tool_schemas, tools_to_payload

logger = logging.getLogger(__name__)


async def snapshot_stdio_tools(
    *,
    name: str,
    user_id: str | None,
    command: str,
    args: list[str],
    cwd: str,
) -> None:
    async with AsyncExitStack() as stack:
        session = await open_stdio_session(stack, command, args, cwd)
        listed = await session.list_tools()
        schemas = tools_to_payload(list(listed.tools))
    await save_tool_schemas(name, user_id, schemas)
    logger.info("本机插件工具清单已快照 name=%s tools=%d（进程已退出）", name, len(schemas))
