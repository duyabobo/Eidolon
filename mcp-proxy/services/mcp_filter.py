"""
解析 MCP 过滤相关 HTTP 头与查询参数。
"""
from __future__ import annotations


def parse_csv_names(raw: str | None) -> list[str] | None:
    """解析逗号分隔的名称列表（Server 名或工具名均可）；空或 None 表示不过滤。"""
    if raw is None:
        return None
    names = [item.strip() for item in raw.split(",") if item.strip()]
    return names or None


def parse_mcp_tools_header(header: str | None) -> list[str] | None:
    """解析 X-Mcp-Tools 请求头（运行时白名单，工具名粒度，见 mcp_cache_manager.py）。"""
    return parse_csv_names(header)
