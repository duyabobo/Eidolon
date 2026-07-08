"""MCP Server 连接辅助：供聚合器与探测复用。"""
import logging
from contextlib import AsyncExitStack
from typing import Any, Literal

from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client

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
    token = api_key.strip()
    if not token:
        return None
    return {"Authorization": f"Bearer {token}"}


async def open_mcp_session(
    stack: AsyncExitStack,
    url: str,
    api_key: str = "",
) -> ClientSession:
    transport = resolve_mcp_transport(url)
    headers = _build_auth_headers(api_key)

    if transport == "sse":
        read, write = await stack.enter_async_context(sse_client(url, headers=headers))
        session: ClientSession = await stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        logger.info("MCP SSE 连接成功 url=%s", url)
        return session

    http_client = create_mcp_http_client(headers=headers) if headers else None
    if http_client is not None:
        await stack.enter_async_context(http_client)

    client_kwargs: dict[str, Any] = {"url": url}
    if http_client is not None:
        client_kwargs["http_client"] = http_client

    read, write, _ = await stack.enter_async_context(streamable_http_client(**client_kwargs))
    session = await stack.enter_async_context(ClientSession(read, write))
    await session.initialize()
    logger.info("MCP Streamable HTTP 连接成功 url=%s", url)
    return session
