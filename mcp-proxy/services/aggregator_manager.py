"""
聚合器管理器：按 (user_id, server_names) 维度缓存 McpAggregator 实例。

缓存键格式：<user_key>::<sorted_server_names_csv>
  - user_key = user_id  或  __system__（系统级 Server）
  - 同一 user 若未指定 server_names，则加载该 user 的全量 Server

失效策略（满足任一则在下次 list_tools 时重建）：
  1. TTL 到期（默认 300s）
  2. 某个 Server 被显式标记失效（add / delete / test 触发）
"""
import logging
from typing import Any

from services.mcp_aggregator import McpAggregator
from services.mongo_client import McpServerEntry, read_mcp_servers

logger = logging.getLogger(__name__)

_SYSTEM_USER_KEY = "__system__"


def _build_cache_key(user_key: str, server_names: list[str] | None) -> str:
    suffix = ",".join(sorted(server_names)) if server_names else "*"
    return f"{user_key}::{suffix}"


def _user_key(user_id: str | None) -> str:
    return user_id if user_id else _SYSTEM_USER_KEY


class McpAggregatorManager:
    def __init__(self, refresh_interval_s: float) -> None:
        self._refresh_interval_s = refresh_interval_s
        self._aggregators: dict[str, McpAggregator] = {}

    def _get_or_create(self, cache_key: str) -> McpAggregator:
        if cache_key not in self._aggregators:
            self._aggregators[cache_key] = McpAggregator(self._refresh_interval_s)
        return self._aggregators[cache_key]

    async def get_aggregator(
        self,
        user_id: str | None,
        server_names: list[str] | None = None,
    ) -> McpAggregator:
        key = _build_cache_key(_user_key(user_id), server_names)
        agg = self._get_or_create(key)
        servers = await _load_servers(user_id, server_names)
        await agg.refresh_if_stale(servers)
        return agg

    async def force_refresh(
        self,
        user_id: str | None,
        server_names: list[str] | None = None,
    ) -> McpAggregator:
        key = _build_cache_key(_user_key(user_id), server_names)
        agg = self._get_or_create(key)
        servers = await _load_servers(user_id, server_names)
        await agg.force_refresh(servers)
        return agg

    def invalidate_server(self, user_id: str | None, server_name: str) -> None:
        """标记单个 Server 失效，精确失效，不影响其他 Server 的缓存。"""
        uk = _user_key(user_id)
        for key, agg in self._aggregators.items():
            if key.startswith(f"{uk}::"):
                agg.invalidate_server(server_name)
        logger.info("Server 缓存标记失效 user=%s server=%s", user_id or "-", server_name)

    def invalidate_user(self, user_id: str | None) -> None:
        """全量失效：清零该用户所有聚合器（全量配置更换时使用）。"""
        uk = _user_key(user_id)
        for key, agg in self._aggregators.items():
            if key.startswith(f"{uk}::"):
                agg.invalidate()
        logger.info("用户全量缓存失效 user=%s", user_id or "-")

    async def close_all(self) -> None:
        for agg in self._aggregators.values():
            await agg.close()
        self._aggregators.clear()


async def _load_servers(
    user_id: str | None,
    server_names: list[str] | None,
) -> list[McpServerEntry]:
    """从 MongoDB 读取 Server 配置，按需过滤。"""
    servers = await read_mcp_servers(user_id, names=server_names)
    if not servers:
        logger.warning("未找到可用 MCP Server user=%s names=%s", user_id or "-", server_names)
    return servers
