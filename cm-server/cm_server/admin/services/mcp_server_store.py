"""系统级 MCP Server 配置：CM 架构下替代原 admin/services/mcp_mongo.py（Mongo → SQLite）。

admin 只管理系统级 Server（`user_id IS NULL`）；用户个人 MCP 由 gateway 管理。
内置工具（arxiv / nature 等）已下放到工具市场，底座不再登记系统级 MCP。
"""
import logging

from pi_shared import format_iso, now_china

from cm_server.admin.models.config import McpConfig, McpServerConfig
from cm_server.admin.services.db import get_db

logger = logging.getLogger(__name__)

_RETIRED_BUILTIN_NAMES = ("arxiv", "nature")


async def retire_builtin_system_servers() -> None:
    """启动时清掉已下放到工具市场的系统 MCP，避免连死地址。"""
    for name in _RETIRED_BUILTIN_NAMES:
        if await delete_server(name):
            logger.info("已移除下放到工具市场的系统 MCP name=%s", name)


async def list_system_config() -> McpConfig:
    rows = await get_db().fetch_all("SELECT * FROM mcp_servers WHERE user_id IS NULL")
    servers = {
        str(row["name"]): McpServerConfig(
            url=str(row["url"]),
            description=str(row.get("description") or ""),
            enabled=bool(row.get("enabled", 1)),
            api_key=str(row.get("api_key") or ""),
        )
        for row in rows
    }
    return McpConfig(servers=servers)


async def upsert_server(name: str, cfg: McpServerConfig) -> None:
    """新增/更新系统 Server；未传 api_key 时保留旧值，避免前端回显脱敏后清空真实 key。

    注：`mcp_servers` 主键是 (name, user_id)，但 SQLite 把 NULL 列视为互不相等，
    系统级记录 `user_id IS NULL` 不会触发 `ON CONFLICT`，必须显式 SELECT 后分支写。
    """
    existing = await get_db().fetch_one(
        "SELECT api_key FROM mcp_servers WHERE name = ? AND user_id IS NULL", (name,)
    )
    api_key = cfg.api_key.strip()
    if not api_key and existing and existing.get("api_key"):
        api_key = str(existing["api_key"])

    now = format_iso(now_china())
    if existing:
        await get_db().execute(
            """
            UPDATE mcp_servers SET url = ?, description = ?, api_key = ?, enabled = ?, updated_at = ?
            WHERE name = ? AND user_id IS NULL
            """,
            (cfg.url, cfg.description, api_key, int(cfg.enabled), now, name),
        )
    else:
        await get_db().execute(
            """
            INSERT INTO mcp_servers (name, user_id, url, description, api_key, enabled, created_at, updated_at)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
            """,
            (name, cfg.url, cfg.description, api_key, int(cfg.enabled), now, now),
        )


async def delete_server(name: str) -> bool:
    cursor = await get_db().execute(
        "DELETE FROM mcp_servers WHERE name = ? AND user_id IS NULL", (name,)
    )
    return cursor.rowcount > 0


async def replace_all_servers(servers: dict[str, McpServerConfig]) -> None:
    """全量替换系统 MCP 配置：先清空再逐个写入。"""
    await get_db().execute("DELETE FROM mcp_servers WHERE user_id IS NULL")
    for name, cfg in servers.items():
        await upsert_server(name, cfg)
