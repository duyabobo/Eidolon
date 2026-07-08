import logging

import httpx
from fastapi import HTTPException, status

from config import settings
from models.mcp import McpServerStatusResponse

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_SECONDS = 30.0


async def fetch_server_status(user_id: str | None) -> McpServerStatusResponse:
    headers: dict[str, str] = {}
    if user_id and user_id.strip():
        headers["X-User-Id"] = user_id.strip()

    url = f"{settings.mcp_proxy_base_url.rstrip('/')}/servers/status"
    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            resp = await client.get(url, headers=headers)
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
