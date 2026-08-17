"""跨服务共享的 mcp-proxy 缓存失效通知。

合并前 admin 与 gateway 各自维护一份 `invalidate_cache`（逻辑一致，仅成功日志有无差异），
合并后统一到这里，两个服务子包按原路径 re-export。
"""
import logging
from urllib.parse import urlencode

import httpx

from cm_server.config import settings
from pi_shared import merge_trace_headers

logger = logging.getLogger(__name__)


async def invalidate_cache(user_id: str | None, server_name: str | None = None) -> None:
    """
    通知 mcp-proxy 失效工具列表缓存。

    - server_name 非空：精确失效该 Server（add/update/delete 单条时使用）
    - server_name 为空：全量失效该用户所有 Server（全量配置替换时使用）
    """
    url = f"{settings.mcp_proxy_base_url.rstrip('/')}/cache/invalidate"
    params: dict[str, str] = {}
    if user_id and user_id.strip():
        params["user_id"] = user_id.strip()
    if server_name and server_name.strip():
        params["server_name"] = server_name.strip()
    query = f"?{urlencode(params)}" if params else ""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(url + query, headers=merge_trace_headers())
        logger.info(
            "mcp-proxy 缓存失效通知已发送 user=%s server=%s",
            user_id or "-", server_name or "-",
        )
    except Exception as exc:
        logger.warning(
            "mcp-proxy 缓存失效通知失败 user=%s server=%s err=%s",
            user_id or "-", server_name or "-", exc,
        )
