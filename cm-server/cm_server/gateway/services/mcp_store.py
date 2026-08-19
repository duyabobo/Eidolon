"""MCP Server 配置读写：CM 架构下替代原 gateway/services/mcp_mongo.py（Mongo → SQLite）。"""
import logging

from pi_shared import format_iso, now_china

from pi_shared.sqlite import dumps, loads

from cm_server.gateway.models.mcp import McpScope, McpServerItem
from cm_server.gateway.services.db import get_db

logger = logging.getLogger(__name__)


def _parse_args(raw: object) -> list[str]:
    parsed = loads(raw, [])
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed]


def _to_item(row: dict) -> McpServerItem:
    user_id = row.get("user_id")
    return McpServerItem(
        name=str(row["name"]),
        url=str(row.get("url") or ""),
        description=str(row.get("description") or ""),
        enabled=bool(row.get("enabled", 1)),
        has_api_key=bool(str(row.get("api_key") or "").strip()),
        scope=McpScope.USER if user_id else McpScope.SYSTEM,
        user_id=str(user_id) if user_id else None,
        transport=str(row.get("transport") or "http"),
        command=str(row.get("command") or ""),
        args=_parse_args(row.get("args")),
        cwd=str(row.get("cwd") or ""),
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
    transport: str = "http",
    command: str = "",
    args: list[str] | None = None,
    cwd: str = "",
) -> McpServerItem:
    db = get_db()
    now = format_iso(now_china())
    existing = await db.fetch_one(
        "SELECT api_key, transport, command, args, cwd FROM mcp_servers WHERE name = ? AND user_id = ?",
        (name, user_id),
    )
    resolved_key = api_key.strip()
    if not resolved_key and existing and existing.get("api_key"):
        resolved_key = str(existing["api_key"])
    if existing:
        if not command and existing.get("command"):
            command = str(existing["command"])
        if not cwd and existing.get("cwd"):
            cwd = str(existing["cwd"])
        if not args:
            args = _parse_args(existing.get("args"))
        if transport == "http" and str(existing.get("transport") or "") == "stdio" and command:
            transport = "stdio"
    args_json = dumps(args or [])

    await db.execute(
        """
        INSERT INTO mcp_servers
        (name, user_id, url, description, api_key, enabled, transport, command, args, cwd, created_at, updated_at)
        VALUES (:name, :user_id, :url, :description, :api_key, :enabled, :transport, :command, :args, :cwd, :now, :now)
        ON CONFLICT (name, user_id) DO UPDATE SET
            url = :url, description = :description, api_key = :api_key,
            enabled = :enabled, transport = :transport, command = :command,
            args = :args, cwd = :cwd, updated_at = :now
        """,
        {
            "name": name, "user_id": user_id, "url": url, "description": description,
            "api_key": resolved_key, "enabled": int(enabled), "now": now,
            "transport": transport, "command": command, "args": args_json, "cwd": cwd,
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
        transport=transport,
        command=command,
        args=args or [],
        cwd=cwd,
    )


async def delete_user_server(user_id: str, name: str) -> bool:
    cursor = await get_db().execute("DELETE FROM mcp_servers WHERE name = ? AND user_id = ?", (name, user_id))
    if cursor.rowcount > 0:
        from cm_server.admin.services.plugins_fs import delete_plugin
        delete_plugin(name, user_id)
    return cursor.rowcount > 0
