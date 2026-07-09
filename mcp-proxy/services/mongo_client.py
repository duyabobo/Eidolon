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
    enabled: bool = True


async def read_mcp_servers(
    user_id: str | None = None,
    *,
    include_disabled: bool = False,
    name: str | None = None,
    names: list[str] | None = None,
    scope: str | None = None,
) -> list[McpServerEntry]:
    """读取系统 MCP + 指定用户的个人 MCP。"""
    db = _get_db()
    query_parts: list[dict[str, Any]] = [_system_user_filter()]
    if user_id and user_id.strip():
        query_parts.append({"user_id": user_id.strip()})

    filters: list[dict[str, Any]] = [{"$or": query_parts}]
    if not include_disabled:
        filters.append({"enabled": {"$ne": False}})
    if names:
        filters.append({"name": {"$in": names}})
    elif name:
        filters.append({"name": name})
    if scope == "system":
        filters.append(_system_user_filter())
    elif scope == "user":
        if not user_id or not user_id.strip():
            return []
        filters.append({"user_id": user_id.strip()})

    mongo_query: dict[str, Any] = {"$and": filters} if len(filters) > 1 else filters[0]
    cursor = db[_COLLECTION].find(mongo_query)
    result: list[McpServerEntry] = []
    async for raw in cursor:
        if not raw.get("url"):
            continue
        entry_scope = "user" if raw.get("user_id") else "system"
        result.append(McpServerEntry(
            name=str(raw["name"]),
            url=str(raw["url"]),
            api_key=str(raw.get("api_key") or ""),
            scope=entry_scope,
            enabled=bool(raw.get("enabled", True)),
        ))

    logger.info(
        "MCP servers user=%s count=%d include_disabled=%s name=%s names=%s scope=%s",
        user_id or "-",
        len(result),
        include_disabled,
        name or "-",
        ",".join(names) if names else "-",
        scope or "-",
    )
    return result


def filter_servers_by_names(
    servers: list[McpServerEntry],
    allowed_names: list[str] | None,
) -> list[McpServerEntry]:
    """按名称白名单过滤；allowed_names 为 None 时返回原列表。"""
    if not allowed_names:
        return servers
    allowed = {name.strip() for name in allowed_names if name.strip()}
    if not allowed:
        return servers
    return [server for server in servers if server.name in allowed]


async def read_enabled_mcp_servers(user_id: str | None = None) -> list[McpServerEntry]:
    """读取已启用的 MCP Server（供 pi 聚合调用）。"""
    return await read_mcp_servers(user_id, include_disabled=False)
