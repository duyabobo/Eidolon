"""
MCP 聚合器管理：按 user_id 维度缓存聚合器，支持系统 + 个人 MCP 隔离加载。
"""
import logging

from services.mcp_aggregator import McpAggregator
from services.mongo_client import McpServerEntry

logger = logging.getLogger(__name__)


class McpAggregatorManager:
    def __init__(self, refresh_interval_s: float) -> None:
        self._refresh_interval_s = refresh_interval_s
        self._aggregators: dict[str, McpAggregator] = {}

    def _key(self, user_id: str | None) -> str:
        return user_id.strip() if user_id and user_id.strip() else "__system__"

    def get(self, user_id: str | None) -> McpAggregator:
        key = self._key(user_id)
        if key not in self._aggregators:
            self._aggregators[key] = McpAggregator(self._refresh_interval_s)
            logger.info("创建 MCP 聚合器 user_key=%s", key)
        return self._aggregators[key]

    async def refresh_if_stale(self, user_id: str | None, servers: list[McpServerEntry]) -> McpAggregator:
        agg = self.get(user_id)
        await agg.refresh_if_stale(servers)
        return agg

    async def close_all(self) -> None:
        for agg in self._aggregators.values():
            await agg.close()
        self._aggregators.clear()
