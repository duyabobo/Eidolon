"""
MongoDB 客户端：读取 mcp_servers 集合（系统 + 用户 MCP）。
"""
import logging
from dataclasses import dataclass
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from config import settings

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None
_COLLECTION = "mcp_servers"


def _get_db() -> AsyncIOMotorDatabase:
    if _client is None:
        raise RuntimeError("MongoDB 未连接，请先调用 connect()")
    return _client[settings.mongo_db]


def _system_user_filter() -> dict[str, Any]:
    return {"$or": [{"user_id": None}, {"user_id": {"$exists": False}}]}


async def connect() -> None:
    global _client
    _client = AsyncIOMotorClient(settings.mongo_uri)
    logger.info("MongoDB 连接成功: %s / %s", settings.mongo_uri, settings.mongo_db)


async def disconnect() -> None:
    global _client
    if _client:
        _client.close()
        _client = None
        logger.info("MongoDB 连接已关闭")


@dataclass
class McpServerEntry:
    name: str
    url: str
    api_key: str = ""
    scope: str = "system"


async def read_enabled_mcp_servers(user_id: str | None = None) -> list[McpServerEntry]:
    """读取系统 MCP + 指定用户的个人 MCP（均已启用）。"""
    db = _get_db()
    query_parts: list[dict[str, Any]] = [{**_system_user_filter(), "enabled": {"$ne": False}}]
    if user_id and user_id.strip():
        query_parts.append({"user_id": user_id.strip(), "enabled": {"$ne": False}})

    cursor = db[_COLLECTION].find({"$or": query_parts})
    result: list[McpServerEntry] = []
    async for raw in cursor:
        if not raw.get("url"):
            continue
        scope = "user" if raw.get("user_id") else "system"
        result.append(McpServerEntry(
            name=str(raw["name"]),
            url=str(raw["url"]),
            api_key=str(raw.get("api_key") or ""),
            scope=scope,
        ))

    logger.info("MCP servers user=%s count=%d", user_id or "-", len(result))
    return result
