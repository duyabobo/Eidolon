"""
MCP 聚合器：连接多个后端 MCP Server，汇总工具列表，路由工具调用。

刷新触发条件（满足任一即触发）：
  1. 距上次刷新超过 TTL（默认 300s）
  2. 有 Server 被显式标记为失效（_invalidated_servers 非空）

并发安全：asyncio.Lock + 双重检查，保证同一时刻只有一个 refresh 执行。
性能：asyncio.gather 并行连接所有 Server，大幅降低多 Server 场景下的加载延迟。
"""
import asyncio
import logging
import time
from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import Any

from mcp import ClientSession
from mcp.types import Tool

from services.mcp_connection import open_mcp_session
from services.mongo_client import McpServerEntry

logger = logging.getLogger(__name__)


@dataclass
class _ToolEntry:
    tool: Tool
    server_name: str
    session: ClientSession


class McpAggregator:
    def __init__(self, refresh_interval_s: float) -> None:
        self._refresh_interval_s = refresh_interval_s
        self._tool_map: dict[str, _ToolEntry] = {}
        self._exit_stack: AsyncExitStack = AsyncExitStack()
        self._last_refresh_at: float = 0.0
        self._invalidated_servers: set[str] = set()
        self._lock: asyncio.Lock = asyncio.Lock()

    def needs_refresh(self) -> bool:
        """TTL 到期 或 有 Server 被手动失效时需要刷新。"""
        return (
            time.monotonic() - self._last_refresh_at >= self._refresh_interval_s
            or bool(self._invalidated_servers)
        )

    def invalidate(self) -> None:
        """全量失效：清零 TTL，下次 refresh_if_stale 时重建所有 Server。"""
        self._last_refresh_at = 0.0
        self._invalidated_servers.clear()

    def invalidate_server(self, server_name: str) -> None:
        """标记单个 Server 失效：add/delete/test 后调用，下次请求时触发重建。"""
        self._invalidated_servers.add(server_name)
        logger.info("Server 缓存标记失效: %s", server_name)

    async def refresh_if_stale(self, servers: list[McpServerEntry]) -> None:
        if not self.needs_refresh():
            return
        async with self._lock:
            if not self.needs_refresh():  # 获锁后再次检查，避免重复刷新
                return
            await self._do_refresh(servers)

    async def force_refresh(self, servers: list[McpServerEntry]) -> None:
        """忽略 TTL，立即重建（用于启动预热）。"""
        async with self._lock:
            await self._do_refresh(servers)

    async def _do_refresh(self, servers: list[McpServerEntry]) -> None:
        old_stack = self._exit_stack
        self._exit_stack = AsyncExitStack()
        self._tool_map.clear()
        self._invalidated_servers.clear()  # 刷新完成后清除失效标记
        await old_stack.aclose()

        await asyncio.gather(
            *(self._connect_and_load_tools(server) for server in servers),
            return_exceptions=True,
        )

        self._last_refresh_at = time.monotonic()
        logger.info("刷新完成，共 %d 个工具", len(self._tool_map))

    def list_tools(self) -> list[dict[str, Any]]:
        return [
            entry.tool.model_dump(by_alias=True, exclude_none=True)
            for entry in self._tool_map.values()
        ]

    async def call_tool(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        entry = self._tool_map.get(name)
        if entry is None:
            raise ValueError(f"工具未找到: {name}")
        logger.info("调用工具: %s → server=%s", name, entry.server_name)
        result = await entry.session.call_tool(name, arguments=args)
        return result.model_dump(by_alias=True, exclude_none=True)

    async def close(self) -> None:
        await self._exit_stack.aclose()

    async def _connect_and_load_tools(self, server: McpServerEntry) -> None:
        try:
            session = await open_mcp_session(self._exit_stack, server.url, server.api_key)
            tools_result = await session.list_tools()
            loaded = 0
            for tool in tools_result.tools:
                if tool.name in self._tool_map:
                    logger.warning(
                        "工具名冲突: '%s' 已存在于 %s，跳过 %s",
                        tool.name, self._tool_map[tool.name].server_name, server.name,
                    )
                    continue
                self._tool_map[tool.name] = _ToolEntry(
                    tool=tool, server_name=server.name, session=session
                )
                loaded += 1
            logger.info("server=%s: 加载 %d 个工具", server.name, loaded)
        except Exception as e:
            logger.error("连接 MCP server 失败: name=%s url=%s err=%s", server.name, server.url, e)
