"""MCP Server 连接辅助：供聚合器与探测复用。"""
import logging
from contextlib import AsyncExitStack
from typing import Any, Literal

import httpx
from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client

from services.request_user import X_USER_ID_HEADER, get_request_user_id

logger = logging.getLogger(__name__)

McpTransport = Literal["sse", "streamable-http"]


def resolve_mcp_transport(url: str) -> McpTransport:
    """根据 URL 推断 MCP 传输协议。

    Cursor 等客户端对 `/mcp/sse` 走 SSE；Streamable HTTP 则对 endpoint POST。
    """
    normalized = url.strip().rstrip("/").lower()
    if normalized.endswith("/sse") or "/mcp/sse" in normalized:
        return "sse"
    return "streamable-http"


def _build_auth_headers(api_key: str) -> dict[str, str] | None:
    """仅静态鉴权头；X-User-Id 由 per-request hook 注入，避免绑死在共享连接上。"""
    token = api_key.strip()
    if not token:
        return None
    return {"Authorization": f"Bearer {token}"}


async def _inject_x_user_id(request: httpx.Request) -> None:
    """每次发往下游 MCP 的 HTTP 请求注入当前入站用户（无则不带头）。"""
    user_id = get_request_user_id()
    if not user_id:
        return
    request.headers[X_USER_ID_HEADER] = user_id


def _attach_user_id_hook(client: httpx.AsyncClient) -> httpx.AsyncClient:
    hooks = client.event_hooks.setdefault("request", [])
    if _inject_x_user_id not in hooks:
        hooks.append(_inject_x_user_id)
    return client


def _mcp_http_client_factory(
    headers: dict[str, str] | None = None,
    timeout: httpx.Timeout | None = None,
    auth: httpx.Auth | None = None,
) -> httpx.AsyncClient:
    """供 SSE / Streamable HTTP 共用：带 X-User-Id 透传钩子的 httpx 客户端。"""
    return _attach_user_id_hook(create_mcp_http_client(headers=headers, timeout=timeout, auth=auth))


async def open_mcp_session(
    stack: AsyncExitStack,
    url: str,
    api_key: str = "",
) -> ClientSession:
    transport = resolve_mcp_transport(url)
    headers = _build_auth_headers(api_key)

    if transport == "sse":
        # SSE 长连接：握手与后续 POST 均走同一 factory 创建的客户端，钩子可注入 X-User-Id。
        # 若某 Server 只认握手头，需改读后续请求头或改用 streamable-http。
        read, write = await stack.enter_async_context(
            sse_client(url, headers=headers, httpx_client_factory=_mcp_http_client_factory),
        )
        session: ClientSession = await stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        logger.info("MCP SSE 连接成功 url=%s", url)
        return session

    # 始终自建 client（即使无 api_key），确保 tools/call 等请求能透传 X-User-Id
    http_client = _mcp_http_client_factory(headers=headers)
    await stack.enter_async_context(http_client)

    read, write, _ = await stack.enter_async_context(
        streamable_http_client(url=url, http_client=http_client),
    )
    session = await stack.enter_async_context(ClientSession(read, write))
    await session.initialize()
    logger.info("MCP Streamable HTTP 连接成功 url=%s", url)
    return session
