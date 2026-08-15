"""
McpServerCacheManager：全局唯一的 MCP Server 缓存管理器。

按 (owner, server_name) 缓存每个真实 MCP Server 的连接与工具列表：
  - 系统级 Server（user_id 为空）→ 缓存键 ("__system__", name)，所有用户共享同一份连接
  - 用户级 Server        → 缓存键 (user_id, name)，仅该用户可见

请求侧的白名单是**工具粒度**，不是 Server 粒度：get_tools 总是加载该用户全部已启用
的 Server（反正已经全局预热好了，命中缓存几乎零开销），合并成完整工具视图后，
再按 tool_names 过滤出请求方声明的具体工具。这样"该连哪些 Server"和"该给哪些工具"
两件事解耦：缓存层永远按真实 Server 组织（同一个 Server 无论被多少种工具白名单引用，
只连接、只缓存一次），过滤层按工具名做一次性、无网络开销的内存过滤。
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
        return [
            cache.get_tool(name).model_dump(by_alias=True, exclude_none=True)
            for name, cache in self._owner_by_tool.items()
        ]

    async def call_tool(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        cache = self._owner_by_tool.get(name)
        if cache is None:
            raise ValueError(f"工具未找到: {name}")
        logger.info("调用工具: %s → server=%s", name, cache.entry.name)
        return await cache.call_tool(name, args)


class McpServerCacheManager:
    def __init__(self, refresh_interval_s: float) -> None:
        self._refresh_interval_s = refresh_interval_s
        self._caches: dict[tuple[str, str], McpServerCache] = {}

    def _get_or_create(self, user_id: str | None, entry: McpServerEntry) -> McpServerCache:
        key = (_owner_of(user_id, entry), entry.name)
        cache = self._caches.get(key)
        if cache is None:
            cache = McpServerCache(entry, self._refresh_interval_s)
            self._caches[key] = cache
        return cache

    async def get_tools(self, user_id: str | None, tool_names: list[str] | None = None) -> McpToolsView:
        """
        读取指定用户在给定工具白名单下可用的工具视图。
        tool_names is None 表示不过滤；[] 表示明确 0 个工具。

        始终加载该用户全部已启用 Server（不按 tool_names 反查该连哪个 Server），
        因为这些 Server 早已被全局预热覆盖，命中缓存的合并开销可忽略；
        真正的过滤发生在 McpToolsView 按工具名做的内存过滤这一步。
        """
        entries = await read_mcp_servers(user_id)
        caches = [self._get_or_create(user_id, entry) for entry in entries]
        await asyncio.gather(*(cache.refresh_if_stale() for cache in caches))
        allowed = None if tool_names is None else set(tool_names)
        return McpToolsView(caches, allowed_tool_names=allowed)

    async def force_refresh(self, user_id: str | None) -> None:
        """
        预热指定用户视角下的全部 Server（用于系统启动预热）。
        user_id=None 预热系统级 Server；否则仅预热该用户的个人 Server
        （系统级 Server 已在 user_id=None 的预热中处理一次，此处跳过避免重复连接）。
        """
        entries = await read_mcp_servers(user_id)
        targets = entries if user_id is None else [e for e in entries if e.scope == "user"]
        caches = [self._get_or_create(user_id, entry) for entry in targets]
        await asyncio.gather(*(cache.force_refresh() for cache in caches))

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
