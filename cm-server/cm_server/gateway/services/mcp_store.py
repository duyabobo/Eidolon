"""MCP Server 配置读写：CM 架构下替代原 gateway/services/mcp_mongo.py（Mongo → SQLite）。"""
import logging

from pi_shared import format_iso, now_china

from cm_server.gateway.models.mcp import McpScope, McpServerItem
from cm_server.gateway.services.db import get_db

logger = logging.getLogger(__name__)


def _to_item(row: dict) -> McpServerItem:
    user_id = row.get("user_id")
    return McpServerItem(
        name=str(row["name"]),
        url=str(row["url"]),
        description=str(row.get("description") or ""),
        enabled=bool(row.get("enabled", 1)),
        has_api_key=bool(str(row.get("api_key") or "").strip()),
        scope=McpScope.USER if user_id else McpScope.SYSTEM,
        user_id=str(user_id) if user_id else None,
    )


async def list_mcp_for_user(
    user_id: str | None,
    *,
    include_disabled: bool = False,
) -> list[McpServerItem]:
    db = get_db()
    system_sql = "SELECT * FROM mcp_servers WHERE user_id IS NULL"
    if not include_disabled:
        system_sql += " AND enabled != 0"
    items = [_to_item(row) for row in await db.fetch_all(system_sql)]

    uid = (user_id or "").strip()
    if uid:
        user_sql = "SELECT * FROM mcp_servers WHERE user_id = ?"
        params: tuple = (uid,)
        if not include_disabled:
            user_sql += " AND enabled != 0"
        items.extend(_to_item(row) for row in await db.fetch_all(user_sql, params))

    items.sort(key=lambda item: (item.scope.value, item.name))
    return items


async def upsert_user_server(
    user_id: str,
    name: str,
    url: str,
    description: str,
    enabled: bool,
    api_key: str = "",
) -> McpServerItem:
    db = get_db()
    now = format_iso(now_china())
    existing = await db.fetch_one("SELECT api_key FROM mcp_servers WHERE name = ? AND user_id = ?", (name, user_id))
    resolved_key = api_key.strip()
    if not resolved_key and existing and existing.get("api_key"):
        resolved_key = str(existing["api_key"])

    await db.execute(
        """
        INSERT INTO mcp_servers (name, user_id, url, description, api_key, enabled, created_at, updated_at)
        VALUES (:name, :user_id, :url, :description, :api_key, :enabled, :now, :now)
        ON CONFLICT (name, user_id) DO UPDATE SET
            url = :url, description = :description, api_key = :api_key,
            enabled = :enabled, updated_at = :now
        """,
        {
            "name": name, "user_id": user_id, "url": url, "description": description,
            "api_key": resolved_key, "enabled": int(enabled), "now": now,
        },
    )
    return McpServerItem(
        name=name,
        url=url,
        description=description,
        enabled=enabled,
        has_api_key=bool(resolved_key),
        scope=McpScope.USER,
        user_id=user_id,
    )


async def delete_user_server(user_id: str, name: str) -> bool:
    cursor = await get_db().execute("DELETE FROM mcp_servers WHERE name = ? AND user_id = ?", (name, user_id))
    return cursor.rowcount > 0
