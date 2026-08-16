"""
单个真实 MCP Server 的连接、工具表与刷新状态。

一个真实的 MCP Server（系统级或某用户个人配置）只对应一个 McpServerCache 实例，
由 McpServerCacheManager 按 (owner, server_name) 缓存。无论请求方声明了怎样的
skill 白名单组合，都只从这里读取工具，不再按"用户 + 白名单组合"重复建立连接、
重复缓存整套工具列表——避免组合爆炸，也避免同一 Server 因为白名单组合不同而被
反复重新连接。

刷新触发条件（满足任一即触发）：
  1. 距上次刷新超过成功 TTL（默认 300s）
  2. 被显式标记失效（add / delete / test 后调用 invalidate）
  3. 上次连接失败，且已超过失败重试间隔（远小于成功 TTL）

失败与成功分开计时的原因：
  连接失败（远程 Server 瞬时不可用）若与成功一样按 300s TTL 缓存，会把"暂时没有
  工具"当成"确认没有工具"缓存 5 分钟，期间所有请求都拿到空列表却不再重试。
"""
import asyncio
import logging
import time
from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import Any

from mcp import ClientSession
from mcp.types import Tool

from cm_server.mcp_proxy.services.mcp_connection import open_mcp_session
from cm_server.mcp_proxy.services.mcp_server_store import McpServerEntry
from cm_server.mcp_proxy.services.request_user import OutboundUserIdSlot, get_request_user_id
from cm_server.mcp_proxy.services.tool_args import normalize_tool_arguments

logger = logging.getLogger(__name__)

# 连接失败后的重试间隔（秒），远小于成功 TTL，避免瞬时故障被缓存 5 分钟
_FAILURE_RETRY_INTERVAL_S = 10.0


@dataclass
class _ToolRecord:
    tool: Tool
    session: ClientSession


class McpServerCache:
    """缓存单个真实 MCP Server 的连接会话与工具列表。"""

    def __init__(self, entry: McpServerEntry, refresh_interval_s: float) -> None:
        self.entry = entry
        self._refresh_interval_s = refresh_interval_s
        self._tools: dict[str, _ToolRecord] = {}
        self._exit_stack: AsyncExitStack = AsyncExitStack()
        self._last_refresh_at: float = 0.0
        self._invalidated: bool = False
        self._failed_at: float | None = None
        self._lock: asyncio.Lock = asyncio.Lock()
        # SSE post_writer 跨 task：call_tool 写入，httpx hook 读取；与 _call_lock 一起防串用户
        self._outbound_user = OutboundUserIdSlot()
        self._call_lock: asyncio.Lock = asyncio.Lock()

    def needs_refresh(self) -> bool:
        if self._invalidated:
            return True
        now = time.monotonic()
        if now - self._last_refresh_at >= self._refresh_interval_s:
            return True
        return self._failed_at is not None and now - self._failed_at >= _FAILURE_RETRY_INTERVAL_S

    def invalidate(self) -> None:
        """标记失效：下次请求（refresh_if_stale）时触发重建。"""
        self._invalidated = True

    async def refresh_if_stale(self) -> None:
        if not self.needs_refresh():
            return
        async with self._lock:
            if not self.needs_refresh():  # 获锁后再次检查，避免并发重复刷新
                return
            await self._do_refresh()

    async def force_refresh(self) -> None:
        """忽略 TTL，立即重建（用于启动预热）。"""
        async with self._lock:
            await self._do_refresh()

    async def _do_refresh(self) -> None:
        old_stack = self._exit_stack
        self._exit_stack = AsyncExitStack()
        self._tools.clear()
        self._invalidated = False
        await self._close_stack_ignoring_cross_task_errors(old_stack)

        try:
            session = await open_mcp_session(
                self._exit_stack,
                self.entry.url,
                self.entry.api_key,
                outbound_user=self._outbound_user,
            )
            tools_result = await session.list_tools()
            for tool in tools_result.tools:
                self._tools[tool.name] = _ToolRecord(tool=tool, session=session)
            self._failed_at = None
            logger.info("server=%s: 加载 %d 个工具", self.entry.name, len(self._tools))
        except Exception as e:
            self._failed_at = time.monotonic()
            logger.error(
                "连接 MCP server 失败: name=%s url=%s err=%s，%.0fs 后重试",
                self.entry.name, self.entry.url, e, _FAILURE_RETRY_INTERVAL_S,
            )
        finally:
            self._last_refresh_at = time.monotonic()

    def last_refresh_failed(self) -> bool:
        return self._failed_at is not None

    def tool_names(self) -> list[str]:
        return list(self._tools.keys())

    def get_tool(self, name: str) -> Tool | None:
        record = self._tools.get(name)
        return record.tool if record else None

    async def call_tool(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        record = self._tools.get(name)
        if record is None:
            raise ValueError(f"工具未找到: {name}")
        user_id = get_request_user_id()
        normalized_args = normalize_tool_arguments(name, args, trusted_user_id=user_id)
        # 串行化 + 槽位：保证 SSE post_writer 读到的 X-User-Id 与本次 call 一致
        async with self._call_lock:
            self._outbound_user.set(user_id)
            try:
                result = await record.session.call_tool(name, arguments=normalized_args)
            finally:
                self._outbound_user.clear()
        return result.model_dump(by_alias=True, exclude_none=True)

    async def close(self) -> None:
        await self._close_stack_ignoring_cross_task_errors(self._exit_stack)

    async def _close_stack_ignoring_cross_task_errors(self, stack: AsyncExitStack) -> None:
        """
        关闭上一轮连接的 AsyncExitStack。

        每次刷新都由调用方所在的 asyncio task 驱动（HTTP 请求 task 或预热 task），
        而上一轮连接是在另一个（可能早已结束的）task 中打开的。MCP SDK 的
        streamable-http 传输内部用 anyio 任务组管理请求生命周期，其取消范围要求
        __aenter__/__aexit__ 发生在同一个 task，跨 task 关闭会抛
        RuntimeError("Attempted to exit cancel scope in a different task ...")。
        这里只是关闭一个即将丢弃的旧连接，关闭失败不影响新连接是否成功，因此
        仅记录日志、不向上抛出，避免这个已知的库限制拖垮正常的刷新流程。
        """
        try:
            await stack.aclose()
        except Exception as e:
            logger.debug("关闭旧 MCP 连接时出现异常（忽略，不影响新连接）: server=%s err=%s", self.entry.name, e)
