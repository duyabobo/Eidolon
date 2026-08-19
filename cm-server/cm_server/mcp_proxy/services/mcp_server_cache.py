"""
单个真实 MCP Server 的连接、工具表与刷新状态。

一个真实的 MCP Server（系统级或某用户个人配置）只对应一个 McpServerCache 实例，
由 McpServerCacheManager 按 (owner, server_name) 缓存。

本机 stdio 插件：
  - 工具清单可从 DB 水合，列工具不拉起进程
  - 第一次 call_tool 才 spawn，空闲超时后退出并保留清单
远程 http：仍按 TTL 保活刷新。
"""
import asyncio
import logging
import time
from contextlib import AsyncExitStack
from typing import Any

from mcp import ClientSession
from mcp.types import Tool

from cm_server.mcp_proxy.services.mcp_connection import open_mcp_session
from cm_server.mcp_proxy.services.mcp_server_store import McpServerEntry
from cm_server.mcp_proxy.services.mcp_tool_catalog import (
    save_tool_schemas,
    tools_from_payload,
    tools_to_payload,
)
from cm_server.mcp_proxy.services.request_user import OutboundUserIdSlot, get_request_user_id
from cm_server.mcp_proxy.services.tool_args import normalize_tool_arguments

logger = logging.getLogger(__name__)

_FAILURE_RETRY_INTERVAL_S = 10.0


class McpServerCache:
    """缓存单个真实 MCP Server 的工具清单；stdio 会话按需保活。"""

    def __init__(self, entry: McpServerEntry, refresh_interval_s: float) -> None:
        self.entry = entry
        self._refresh_interval_s = refresh_interval_s
        self._tools: dict[str, Tool] = tools_from_payload(entry.tool_schemas)
        self._session: ClientSession | None = None
        self._exit_stack: AsyncExitStack = AsyncExitStack()
        self._last_refresh_at: float = 0.0
        self._last_used_at: float = 0.0
        self._invalidated: bool = False
        self._failed_at: float | None = None
        self._in_flight = 0
        self._lock: asyncio.Lock = asyncio.Lock()
        self._outbound_user = OutboundUserIdSlot()
        self._call_lock: asyncio.Lock = asyncio.Lock()

    @property
    def is_local_stdio(self) -> bool:
        return self.entry.transport == "stdio"

    def has_tool_catalog(self) -> bool:
        return bool(self._tools)

    def replace_entry(self, entry: McpServerEntry) -> None:
        self.entry = entry
        if self._session is None and entry.tool_schemas:
            hydrated = tools_from_payload(entry.tool_schemas)
            if hydrated:
                self._tools = hydrated

    def needs_refresh(self) -> bool:
        if self.is_local_stdio:
            if self._tools and not self._invalidated:
                return False
            if self._failed_at is not None and time.monotonic() - self._failed_at < _FAILURE_RETRY_INTERVAL_S:
                return False
            return self._invalidated or not self._tools
        if self._invalidated:
            return True
        now = time.monotonic()
        if now - self._last_refresh_at >= self._refresh_interval_s:
            return True
        return self._failed_at is not None and now - self._failed_at >= _FAILURE_RETRY_INTERVAL_S

    def invalidate(self) -> None:
        self._invalidated = True

    def _touch(self) -> None:
        self._last_used_at = time.monotonic()

    async def refresh_if_stale(self) -> None:
        if not self.needs_refresh():
            return
        async with self._lock:
            if not self.needs_refresh():
                return
            if self.is_local_stdio:
                await self._connect_locked(keep_alive=False)
                return
            await self._connect_locked(keep_alive=True)

    async def force_refresh(self) -> None:
        async with self._lock:
            await self._connect_locked(keep_alive=not self.is_local_stdio)

    async def _connect_locked(self, *, keep_alive: bool) -> None:
        new_stack = AsyncExitStack()
        try:
            session = await open_mcp_session(
                new_stack,
                self.entry.url,
                self.entry.api_key,
                outbound_user=self._outbound_user,
                transport=self.entry.transport,
                command=self.entry.command,
                args=self.entry.args,
                cwd=self.entry.cwd,
            )
            listed = await session.list_tools()
            tools = list(listed.tools)
            self._tools = {tool.name: tool for tool in tools}
            try:
                await save_tool_schemas(
                    self.entry.name,
                    self.entry.user_id,
                    tools_to_payload(tools),
                )
            except Exception:
                logger.exception("落库工具清单失败 name=%s", self.entry.name)
            old_stack = self._exit_stack
            if keep_alive:
                self._exit_stack = new_stack
                self._session = session
                self._touch()
                await self._close_stack_ignoring_cross_task_errors(old_stack)
                logger.info(
                    "MCP 已连接 name=%s transport=%s tools=%d",
                    self.entry.name, self.entry.transport, len(self._tools),
                )
            else:
                self._session = None
                await self._close_stack_ignoring_cross_task_errors(new_stack)
                await self._close_stack_ignoring_cross_task_errors(old_stack)
                self._exit_stack = AsyncExitStack()
                logger.info(
                    "本机插件已快照工具清单并退出 name=%s tools=%d",
                    self.entry.name, len(self._tools),
                )
            self._failed_at = None
            self._invalidated = False
        except Exception as exc:
            await self._close_stack_ignoring_cross_task_errors(new_stack)
            self._failed_at = time.monotonic()
            logger.error(
                "连接 MCP 失败: name=%s transport=%s err=%s，%.0fs 后重试",
                self.entry.name, self.entry.transport, exc, _FAILURE_RETRY_INTERVAL_S,
            )
        finally:
            self._last_refresh_at = time.monotonic()

    async def _ensure_session_locked(self) -> None:
        if self._session is not None and not self._invalidated:
            return
        await self._connect_locked(keep_alive=True)

    async def _disconnect_locked(self) -> None:
        if self._session is None:
            return
        old_stack = self._exit_stack
        self._session = None
        self._exit_stack = AsyncExitStack()
        await self._close_stack_ignoring_cross_task_errors(old_stack)
        logger.info("本机插件空闲已退出 name=%s", self.entry.name)

    async def release_if_idle(self, idle_timeout_s: float) -> None:
        if not self.is_local_stdio or idle_timeout_s <= 0:
            return
        async with self._lock:
            if self._session is None or self._in_flight > 0:
                return
            if time.monotonic() - self._last_used_at < idle_timeout_s:
                return
            await self._disconnect_locked()

    def last_refresh_failed(self) -> bool:
        return self._failed_at is not None

    def tool_names(self) -> list[str]:
        return list(self._tools.keys())

    def get_tool(self, name: str) -> Tool | None:
        return self._tools.get(name)

    async def call_tool(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        if name not in self._tools:
            async with self._lock:
                await self._ensure_session_locked()
        if name not in self._tools:
            raise ValueError(f"工具未找到: {name}")
        user_id = get_request_user_id()
        normalized_args = normalize_tool_arguments(name, args, trusted_user_id=user_id)
        async with self._call_lock:
            async with self._lock:
                await self._ensure_session_locked()
                if self._session is None:
                    raise RuntimeError(f"插件未能启动: {self.entry.name}")
                session = self._session
                self._in_flight += 1
                self._touch()
            self._outbound_user.set(user_id)
            try:
                result = await self._invoke_with_stdio_retry(session, name, normalized_args)
            finally:
                self._outbound_user.clear()
                async with self._lock:
                    self._in_flight = max(0, self._in_flight - 1)
                    self._touch()
        return result.model_dump(by_alias=True, exclude_none=True)

    async def _invoke_with_stdio_retry(
        self,
        session: ClientSession,
        name: str,
        arguments: dict[str, Any],
    ):
        try:
            return await session.call_tool(name, arguments=arguments)
        except Exception:
            if not self.is_local_stdio:
                raise
            logger.warning("本机插件调用失败，重连后重试 name=%s tool=%s", self.entry.name, name)
            async with self._lock:
                await self._connect_locked(keep_alive=True)
                if self._session is None:
                    raise
                session = self._session
                self._touch()
            return await session.call_tool(name, arguments=arguments)

    async def close(self) -> None:
        async with self._lock:
            await self._disconnect_locked()

    async def _close_stack_ignoring_cross_task_errors(self, stack: AsyncExitStack) -> None:
        try:
            await stack.aclose()
        except Exception as exc:
            logger.debug(
                "关闭旧 MCP 连接时出现异常（忽略）: server=%s err=%s",
                self.entry.name, exc,
            )
