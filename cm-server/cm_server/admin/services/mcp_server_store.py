"""系统级 MCP / 本机插件配置。admin 只管 user_id IS NULL；个人插件由 gateway 管理。"""
import json
import logging

from pi_shared import format_iso, now_china
from pi_shared.sqlite import loads

from cm_server.admin.models.config import McpConfig, McpServerConfig
from cm_server.admin.services.db import get_db

logger = logging.getLogger(__name__)

_RETIRED_BUILTIN_NAMES = ("arxiv", "nature")


def _row_to_config(row: dict) -> McpServerConfig:
    raw_args = loads(row.get("args"), [])
    args = [str(item) for item in raw_args] if isinstance(raw_args, list) else []
    transport = str(row.get("transport") or "http")
    return McpServerConfig(
        url=str(row.get("url") or ""),
        description=str(row.get("description") or ""),
        enabled=bool(row.get("enabled", 1)),
        api_key=str(row.get("api_key") or ""),
        transport=transport if transport in {"http", "stdio"} else "http",
        command=str(row.get("command") or ""),
        args=args,
        cwd=str(row.get("cwd") or ""),
    )


async def retire_builtin_system_servers() -> None:
    """启动时清掉已下放到插件市场的系统 MCP，避免连死地址。"""
    for name in _RETIRED_BUILTIN_NAMES:
        if await delete_server(name):
            logger.info("已移除下放到插件市场的系统 MCP name=%s", name)


async def list_system_config() -> McpConfig:
    rows = await get_db().fetch_all("SELECT * FROM mcp_servers WHERE user_id IS NULL")
    servers = {str(row["name"]): _row_to_config(row) for row in rows}
    return McpConfig(servers=servers)


async def upsert_server(name: str, cfg: McpServerConfig) -> None:
    existing = await get_db().fetch_one(
        "SELECT api_key, transport, command, args, cwd FROM mcp_servers WHERE name = ? AND user_id IS NULL",
        (name,),
    )
    api_key = cfg.api_key.strip()
    if not api_key and existing and existing.get("api_key"):
        api_key = str(existing["api_key"])

    transport = cfg.transport
    command = cfg.command
    args = list(cfg.args)
    cwd = cfg.cwd
    if existing:
        if not command and existing.get("command"):
            command = str(existing["command"])
        if not cwd and existing.get("cwd"):
            cwd = str(existing["cwd"])
        if not args:
            raw_args = loads(existing.get("args"), [])
            if isinstance(raw_args, list):
                args = [str(item) for item in raw_args]
        if transport == "http" and str(existing.get("transport") or "") == "stdio" and command:
            transport = "stdio"

    now = format_iso(now_china())
    args_json = json.dumps(args)
    if existing:
        await get_db().execute(
            """
            UPDATE mcp_servers
            SET url = ?, description = ?, api_key = ?, enabled = ?,
                transport = ?, command = ?, args = ?, cwd = ?, updated_at = ?
            WHERE name = ? AND user_id IS NULL
            """,
            (
                cfg.url, cfg.description, api_key, int(cfg.enabled),
                transport, command, args_json, cwd, now, name,
            ),
        )
        return
    await get_db().execute(
        """
        INSERT INTO mcp_servers
        (name, user_id, url, description, api_key, enabled, transport, command, args, cwd, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name, cfg.url, cfg.description, api_key, int(cfg.enabled),
            transport, command, args_json, cwd, now, now,
        ),
    )


async def delete_server(name: str) -> bool:
    cursor = await get_db().execute(
        "DELETE FROM mcp_servers WHERE name = ? AND user_id IS NULL", (name,)
    )
    if cursor.rowcount > 0:
        from cm_server.admin.services.plugins_fs import delete_plugin
        delete_plugin(name, None)
    return cursor.rowcount > 0


async def replace_all_servers(servers: dict[str, McpServerConfig]) -> None:
    await get_db().execute("DELETE FROM mcp_servers WHERE user_id IS NULL")
    for name, cfg in servers.items():
        await upsert_server(name, cfg)
