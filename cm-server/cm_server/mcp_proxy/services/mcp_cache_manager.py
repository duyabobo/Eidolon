"""
McpServerCacheManager：全局唯一的 MCP Server 缓存管理器。

按 (owner, server_name) 缓存每个真实 MCP Server 的连接与工具列表：
  - 系统级 Server（user_id 为空）→ 缓存键 ("__system__", name)，所有用户共享同一份连接
  - 用户级 Server        → 缓存键 (user_id, name)，仅该用户可见

请求侧的白名单是**工具粒度**，不是 Server 粒度：get_tools 合并该用户已启用
Server 的工具清单后，再按 tool_names 内存过滤。本机 stdio 用已落库清单，不预热进程；
远程 http 仍按 TTL 保活。
"""
import asyncio
import logging
from typing import Any

from cm_server.mcp_proxy.services.mcp_server_cache import McpServerCache
from cm_server.mcp_proxy.services.mcp_server_store import McpServerEntry, read_mcp_servers

logger = logging.getLogger(__name__)

_SYSTEM_OWNER = "__system__"


def _owner_of(user_id: str | None, entry: McpServerEntry) -> str:
    """缓存归属方：系统级 Server 恒为全局共享，用户级 Server 归属该用户。"""
    return _SYSTEM_OWNER if entry.scope == "system" else (user_id or _SYSTEM_OWNER)


class McpToolsView:
    """
    单次请求的工具视图：合并若干已缓存 Server 的工具，按工具名白名单过滤，
    不持有自己的连接状态。
    """

    def __init__(
        self,
        caches: list[McpServerCache],
        allowed_tool_names: set[str] | None = None,
    ) -> None:
        self._owner_by_tool: dict[str, McpServerCache] = {}
        for cache in caches:
            for name in cache.tool_names():
                if allowed_tool_names is not None and name not in allowed_tool_names:
                    continue
                existing = self._owner_by_tool.get(name)
                if existing is not None:
                    logger.warning(
                        "工具名冲突: '%s' 已存在于 %s，跳过 %s",
                        name, existing.entry.name, cache.entry.name,
                    )
                    continue
                self._owner_by_tool[name] = cache

    def list_tools(self) -> list[dict[str, Any]]:
        listed: list[dict[str, Any]] = []
        for name, cache in self._owner_by_tool.items():
            tool = cache.get_tool(name)
            if tool is None:
                continue
            listed.append(tool.model_dump(by_alias=True, exclude_none=True))
        return listed

    async def call_tool(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        cache = self._owner_by_tool.get(name)
        if cache is None:
            raise ValueError(f"工具未找到: {name}")
        logger.info("调用工具: %s → server=%s", name, cache.entry.name)
        return await cache.call_tool(name, args)


class McpServerCacheManager:
    def __init__(
        self,
        refresh_interval_s: float,
        stdio_idle_timeout_s: float = 120.0,
        stdio_idle_sweep_interval_s: float = 15.0,
    ) -> None:
        self._refresh_interval_s = refresh_interval_s
        self._stdio_idle_timeout_s = stdio_idle_timeout_s
        self._stdio_idle_sweep_interval_s = stdio_idle_sweep_interval_s
        self._caches: dict[tuple[str, str], McpServerCache] = {}

    def _get_or_create(self, user_id: str | None, entry: McpServerEntry) -> McpServerCache:
        key = (_owner_of(user_id, entry), entry.name)
        cache = self._caches.get(key)
        if cache is None:
            cache = McpServerCache(entry, self._refresh_interval_s)
            self._caches[key] = cache
        else:
            cache.replace_entry(entry)
        return cache

    async def get_tools(self, user_id: str | None, tool_names: list[str] | None = None) -> McpToolsView:
        """
        读取指定用户在给定工具白名单下可用的工具视图。
        tool_names is None 表示不过滤；[] 表示明确 0 个工具。

        本机 stdio：有落库清单则不拉起进程；没有清单才快照一次并立刻退出。
        远程 http：按 TTL 刷新保活连接。
        """
        entries = await read_mcp_servers(user_id)
        caches = [self._get_or_create(user_id, entry) for entry in entries]
        await asyncio.gather(*(cache.refresh_if_stale() for cache in caches))
        allowed = None if tool_names is None else set(tool_names)
        view = McpToolsView(caches, allowed_tool_names=allowed)
        retry = [
            cache for cache in caches
            if cache.last_refresh_failed() and not cache.has_tool_catalog()
        ]
        if entries and tool_names != [] and not view.list_tools() and retry:
            logger.warning(
                "MCP 工具视图为空且缓存失败，强制刷新 user=%s servers=%s",
                user_id or "-",
                ",".join(cache.entry.name for cache in retry),
            )
            await asyncio.gather(*(cache.force_refresh() for cache in retry))
            view = McpToolsView(caches, allowed_tool_names=allowed)
        return view

    async def force_refresh(self, user_id: str | None) -> None:
        """预热远程 http；本机 stdio 只水合清单，不拉起进程。"""
        entries = await read_mcp_servers(user_id)
        targets = entries if user_id is None else [e for e in entries if e.scope == "user"]
        remote = [entry for entry in targets if entry.transport != "stdio"]
        for entry in targets:
            if entry.transport == "stdio":
                self._get_or_create(user_id, entry)
        caches = [self._get_or_create(user_id, entry) for entry in remote]
        await asyncio.gather(*(cache.force_refresh() for cache in caches))

    async def recycle_idle_stdio(self) -> None:
        await asyncio.gather(
            *(cache.release_if_idle(self._stdio_idle_timeout_s) for cache in self._caches.values())
        )

    def start_idle_reaper(self) -> asyncio.Task:
        interval = self._stdio_idle_sweep_interval_s

        async def _loop() -> None:
            while True:
                await asyncio.sleep(interval)
                try:
                    await self.recycle_idle_stdio()
                except Exception:
                    logger.exception("本机插件空闲回收失败")

        logger.info(
            "本机插件空闲回收已启动 idle=%.0fs sweep=%.0fs",
            self._stdio_idle_timeout_s, interval,
        )
        return asyncio.create_task(_loop(), name="mcp-stdio-idle-reaper")

    def invalidate_server(self, user_id: str | None, server_name: str) -> None:
        """标记单个 Server 缓存失效：add/delete/test 后调用，下次请求时触发重建。"""
        key = (user_id or _SYSTEM_OWNER, server_name)
        cache = self._caches.get(key)
        if cache:
            cache.invalidate()
        logger.info("Server 缓存标记失效 user=%s server=%s", user_id or "-", server_name)

    def invalidate_user(self, user_id: str | None) -> None:
        """全量失效指定用户视角下的 Server 缓存（user_id=None 时为全部系统级 Server）。"""
        owner = user_id or _SYSTEM_OWNER
        for (cache_owner, _name), cache in self._caches.items():
            if cache_owner == owner:
                cache.invalidate()
        logger.info("全量缓存失效 user=%s", user_id or "-")

    async def close_all(self) -> None:
        await asyncio.gather(*(cache.close() for cache in self._caches.values()))
        self._caches.clear()
