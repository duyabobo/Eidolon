"""
MCP 聚合器管理：按 user_id + Server 集合维度缓存聚合器。
"""
import logging

from services.mcp_aggregator import McpAggregator
from services.mongo_client import McpServerEntry

logger = logging.getLogger(__name__)


class McpAggregatorManager:
    def __init__(self, refresh_interval_s: float) -> None:
        self._refresh_interval_s = refresh_interval_s
        self._aggregators: dict[str, McpAggregator] = {}

    def _user_key(self, user_id: str | None) -> str:
        return user_id.strip() if user_id and user_id.strip() else "__system__"

    def _cache_key(self, user_id: str | None, server_names: tuple[str, ...] | None) -> str:
        user_key = self._user_key(user_id)
        if not server_names:
            return f"{user_key}::__all__"
        return f"{user_key}::" + ",".join(server_names)

    def get(self, user_id: str | None, server_names: tuple[str, ...] | None = None) -> McpAggregator:
        key = self._cache_key(user_id, server_names)
        if key not in self._aggregators:
            self._aggregators[key] = McpAggregator(self._refresh_interval_s)
            logger.info("创建 MCP 聚合器 cache_key=%s", key)
        return self._aggregators[key]

    async def refresh_if_stale(
        self,
        user_id: str | None,
        servers: list[McpServerEntry],
        server_names: tuple[str, ...] | None = None,
    ) -> McpAggregator:
        agg = self.get(user_id, server_names)
        await agg.refresh_if_stale(servers)
        return agg

    async def close_all(self) -> None:
        for agg in self._aggregators.values():
            await agg.close()
        self._aggregators.clear()
