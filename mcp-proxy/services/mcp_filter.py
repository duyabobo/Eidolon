"""
解析 MCP Server 过滤相关 HTTP 头与查询参数。
"""
from __future__ import annotations


def parse_csv_names(raw: str | None) -> list[str] | None:
    """解析逗号分隔的 Server 名称；空或 None 表示不过滤。"""
    if raw is None:
        return None
    names = [item.strip() for item in raw.split(",") if item.strip()]
    return names or None


def parse_mcp_server_header(header: str | None) -> list[str] | None:
    """解析 X-Mcp-Servers 请求头。"""
    return parse_csv_names(header)
