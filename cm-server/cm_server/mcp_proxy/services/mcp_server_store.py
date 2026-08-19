"""MCP Server 配置只读查询：CM 架构下替代原 mcp-proxy/services/mongo_client.py（Mongo → SQLite）。"""
import logging
from dataclasses import dataclass, field

from pi_shared.sqlite import loads

from cm_server.mcp_proxy.services.db import get_db

logger = logging.getLogger(__name__)


@dataclass
class McpServerEntry:
    name: str
    url: str
    api_key: str = ""
    scope: str = "system"
    enabled: bool = True
    transport: str = "http"
    command: str = ""
    args: list[str] = field(default_factory=list)
    cwd: str = ""


def _row_to_entry(row: dict) -> McpServerEntry:
    raw_args = loads(row.get("args"), [])
    args = [str(item) for item in raw_args] if isinstance(raw_args, list) else []
    return McpServerEntry(
        name=str(row["name"]),
        url=str(row.get("url") or ""),
        api_key=str(row.get("api_key") or ""),
        scope="user" if row.get("user_id") else "system",
        enabled=bool(row.get("enabled", 1)),
        transport=str(row.get("transport") or "http"),
        command=str(row.get("command") or ""),
        args=args,
        cwd=str(row.get("cwd") or ""),
    )


async def read_mcp_servers(
    user_id: str | None = None,
    *,
    include_disabled: bool = False,
    name: str | None = None,
    names: list[str] | None = None,
    scope: str | None = None,
) -> list[McpServerEntry]:
    """读取系统 MCP + 指定用户的个人 MCP。"""
    db = get_db()
    clauses: list[str] = []
    params: dict = {}

    uid = (user_id or "").strip()
    if scope == "system":
        clauses.append("user_id IS NULL")
    elif scope == "user":
        if not uid:
            return []
        clauses.append("user_id = :user_id")
        params["user_id"] = uid
    elif uid:
        clauses.append("(user_id IS NULL OR user_id = :user_id)")
        params["user_id"] = uid
    else:
        clauses.append("user_id IS NULL")

    if not include_disabled:
        clauses.append("enabled != 0")
    if names:
        placeholders = ", ".join(f":name{i}" for i in range(len(names)))
        clauses.append(f"name IN ({placeholders})")
        params.update({f"name{i}": n for i, n in enumerate(names)})
    elif name:
        clauses.append("name = :name")
        params["name"] = name

    sql = f"SELECT * FROM mcp_servers WHERE {' AND '.join(clauses)}"
    rows = await db.fetch_all(sql, params)
    result = [
        _row_to_entry(row)
        for row in rows
        if row.get("url") or str(row.get("transport") or "") == "stdio"
    ]

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


async def list_user_ids_with_mcp() -> list[str]:
    """返回有 MCP Server 配置的所有 user_id（用于启动预热）。"""
    rows = await get_db().fetch_all(
        "SELECT DISTINCT user_id FROM mcp_servers WHERE user_id IS NOT NULL AND user_id != ''"
    )
    return [str(row["user_id"]).strip() for row in rows if str(row.get("user_id") or "").strip()]
