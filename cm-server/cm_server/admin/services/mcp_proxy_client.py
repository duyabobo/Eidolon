"""
Admin 侧调用 mcp-proxy 的工具函数。

合并后 `invalidate_cache` 与 gateway 侧统一到 cm_server.shared.mcp_cache，此处按原路径转发。
"""
from cm_server.shared.mcp_cache import invalidate_cache

__all__ = ["invalidate_cache"]
