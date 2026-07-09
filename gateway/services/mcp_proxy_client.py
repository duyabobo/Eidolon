import logging
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status

from config import settings
from models.mcp import McpScope, McpServerStatusItem, McpServerStatusResponse
from pi_shared import merge_trace_headers

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_SECONDS = 60.0


def _status_headers(user_id: str | None) -> dict[str, str]:
    headers: dict[str, str] = {}
    if user_id and user_id.strip():
        headers["X-User-Id"] = user_id.strip()
    return merge_trace_headers(headers)


async def fetch_server_status(
    user_id: str | None,
    *,
    include_disabled: bool = False,
    name: str | None = None,
    scope: McpScope | None = None,
) -> McpServerStatusResponse:
    params: dict[str, str] = {}
    if include_disabled:
        params["include_disabled"] = "true"
    if name:
        params["name"] = name
    if scope:
        params["scope"] = scope.value

    query = f"?{urlencode(params)}" if params else ""
    url = f"{settings.mcp_proxy_base_url.rstrip('/')}/servers/status{query}"
    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            resp = await client.get(url, headers=_status_headers(user_id))
    except httpx.RequestError as exc:
        logger.error("mcp-proxy 不可达 url=%s err=%s", url, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="MCP 探测服务不可用",
        ) from exc

    if resp.status_code >= 400:
        logger.error("mcp-proxy 探测失败 status=%s body=%s", resp.status_code, resp.text[:200])
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="MCP 探测失败",
        )

    payload = resp.json()
    return McpServerStatusResponse.model_validate(payload)


async def probe_single_server(
    user_id: str | None,
    name: str,
    scope: McpScope,
) -> McpServerStatusItem:
    response = await fetch_server_status(user_id, include_disabled=True, name=name, scope=scope)
    if not response.servers:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"MCP server '{name}' 不存在")
    return response.servers[0]


async def invalidate_cache(user_id: str | None, server_name: str | None = None) -> None:
    """
    通知 mcp-proxy 失效工具列表缓存。

    - server_name 非空：精确失效该 Server，其他 Server 缓存不受影响
    - server_name 为空：全量失效该用户所有 Server（用于全量配置替换）
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
    except Exception as exc:
        logger.warning(
            "mcp-proxy 缓存失效通知失败 user=%s server=%s err=%s",
            user_id or "-", server_name or "-", exc,
        )
