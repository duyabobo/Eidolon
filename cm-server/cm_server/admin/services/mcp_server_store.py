"""系统级 MCP Server 配置：CM 架构下替代原 admin/services/mcp_mongo.py（Mongo → SQLite）。

admin 只管理系统级 Server（`user_id IS NULL`）；用户个人 MCP 由 gateway 管理。
"""
import logging
import os
from typing import Any

from pi_shared import format_iso, now_china

from cm_server.admin.models.config import McpConfig, McpServerConfig
from cm_server.admin.services.db import get_db

logger = logging.getLogger(__name__)

# Electron 桌面端把内置 MCP 当子进程拉起，每次启动分配的本机端口都不同
# （见 electron/src/ports.ts + process-manager.ts），通过环境变量把当次真实地址传进来。
# Docker 部署没有这些环境变量，退回下面硬编码的容器内 DNS 地址。
_ARXIV_MCP_URL_ENV = "ARXIV_MCP_URL"
_NATURE_MCP_URL_ENV = "NATURE_MCP_URL"

# 平台内置系统级 MCP。url 默认值仅在对应 *_MCP_URL 未设置（Docker 场景）时生效；
# 桌面端每次启动都会用环境变量里的真实端口刷新 url，但不动 enabled/api_key
# （尊重用户在 Admin 页手动开关/改配置的操作）。
_BUILTIN_SYSTEM_SERVERS: tuple[dict[str, Any], ...] = (
    {
        "name": "arxiv",
        "url": "http://arxiv-mcp:8081/mcp",
        "description": "平台内置 arXiv：检索、全文/PDF、LaTeX、引用图谱",
        "enabled": True,
        "api_key": "",
        "url_env": _ARXIV_MCP_URL_ENV,
    },
    {
        "name": "nature",
        "url": "http://nature-mcp:8082/mcp",
        "description": "平台内置 Nature/Science 检索：OpenAlex/S2/Crossref/Unpaywall；元数据+合法 OA",
        "enabled": True,
        "api_key": "",
        "url_env": _NATURE_MCP_URL_ENV,
    },
)


def _resolve_builtin_url(spec: dict[str, Any]) -> str:
    """桌面端环境变量覆盖优先，仅对同名内置 Server 生效，避免影响其它内置项。"""
    url_env = str(spec.get("url_env") or "")
    if url_env:
        override = os.environ.get(url_env)
        if override:
            return override
    return str(spec["url"])


async def _refresh_builtin_url(name: str, url: str) -> None:
    """已存在的内置 Server 记录，仅刷新 url（不动 enabled/api_key）。"""
    now = format_iso(now_china())
    await get_db().execute(
        "UPDATE mcp_servers SET url = ?, updated_at = ? WHERE name = ? AND user_id IS NULL",
        (url, now, name),
    )
    logger.info("已刷新内置系统 MCP url name=%s url=%s", name, url)


async def _insert_builtin_server(spec: dict[str, Any], url: str) -> None:
    now = format_iso(now_china())
    await get_db().execute(
        """
        INSERT INTO mcp_servers (name, user_id, url, description, api_key, enabled, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(spec["name"]), url, spec.get("description", ""), spec.get("api_key", ""),
            int(spec.get("enabled", True)), now, now,
        ),
    )
    logger.info("已登记内置系统 MCP name=%s url=%s", spec["name"], url)


async def ensure_builtin_system_servers() -> None:
    """幂等登记平台内置 MCP Server（user_id=null）；桌面端额外刷新动态端口的 url。"""
    for spec in _BUILTIN_SYSTEM_SERVERS:
        name = str(spec["name"])
        url = _resolve_builtin_url(spec)
        url_env = str(spec.get("url_env") or "")
        has_override = bool(url_env and os.environ.get(url_env))
        existing = await get_db().fetch_one(
            "SELECT 1 FROM mcp_servers WHERE name = ? AND user_id IS NULL", (name,)
        )
        if existing:
            if has_override:
                await _refresh_builtin_url(name, url)
            continue
        await _insert_builtin_server(spec, url)


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
