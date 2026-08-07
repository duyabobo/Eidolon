"""MCP Server 连接辅助：供聚合器与探测复用。"""
import logging
from contextlib import AsyncExitStack
from typing import Literal

import httpx
from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client

from config import settings
from services.request_user import (
    X_USER_ID_HEADER,
    OutboundUserIdSlot,
    get_request_user_id,
)

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


def _downstream_http_timeout() -> httpx.Timeout:
    """下游 MCP HTTP 超时（arxiv 等外网调用常超过 SDK 默认 30s）。"""
    return httpx.Timeout(
        connect=settings.mcp_downstream_connect_timeout_s,
        read=settings.mcp_downstream_read_timeout_s,
        write=settings.mcp_downstream_connect_timeout_s,
        pool=settings.mcp_downstream_connect_timeout_s,
    )


def _resolve_outbound_user_id(slot: OutboundUserIdSlot | None) -> str | None:
    """优先读连接级槽位（SSE 跨 task），否则回退 ContextVar（streamable-http 同 task）。"""
    if slot is not None:
        slotted = slot.get()
        if slotted:
            return slotted
    return get_request_user_id()


def _make_http_client_factory(outbound_user: OutboundUserIdSlot | None = None):
    """带 X-User-Id 透传钩子的 httpx factory；outbound_user 供 SSE 跨 task 注入。"""

    async def inject_x_user_id(request: httpx.Request) -> None:
        user_id = _resolve_outbound_user_id(outbound_user)
        if not user_id:
            return
        request.headers[X_USER_ID_HEADER] = user_id

    def factory(
        headers: dict[str, str] | None = None,
        timeout: httpx.Timeout | None = None,
        auth: httpx.Auth | None = None,
    ) -> httpx.AsyncClient:
        client = create_mcp_http_client(
            headers=headers,
            timeout=timeout or _downstream_http_timeout(),
            auth=auth,
        )
        hooks = client.event_hooks.setdefault("request", [])
        hooks.append(inject_x_user_id)
        return client

    return factory


async def open_mcp_session(
    stack: AsyncExitStack,
    url: str,
    api_key: str = "",
    outbound_user: OutboundUserIdSlot | None = None,
) -> ClientSession:
    transport = resolve_mcp_transport(url)
    headers = _build_auth_headers(api_key)
    http_client_factory = _make_http_client_factory(outbound_user)

    if transport == "sse":
        # SSE：post_writer 在独立 task；须配合 OutboundUserIdSlot，勿只依赖 ContextVar。
        # 若某 Server 只认握手头，需改读后续请求头或改用 streamable-http。
        read, write = await stack.enter_async_context(
            sse_client(url, headers=headers, httpx_client_factory=http_client_factory),
        )
        session: ClientSession = await stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        logger.info("MCP SSE 连接成功 url=%s", url)
        return session

    # 始终自建 client（即使无 api_key），确保 tools/call 等请求能透传 X-User-Id
    http_client = http_client_factory(headers=headers)
    await stack.enter_async_context(http_client)

    read, write, _ = await stack.enter_async_context(
        streamable_http_client(url=url, http_client=http_client),
    )
    session = await stack.enter_async_context(ClientSession(read, write))
    await session.initialize()
    logger.info("MCP Streamable HTTP 连接成功 url=%s", url)
    return session
