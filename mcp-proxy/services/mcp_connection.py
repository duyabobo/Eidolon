"""MCP Server 连接辅助：供聚合器与探测复用。"""
from contextlib import AsyncExitStack
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client


async def open_mcp_session(
    stack: AsyncExitStack,
    url: str,
    api_key: str = "",
) -> ClientSession:
    headers = {"Authorization": f"Bearer {api_key.strip()}"} if api_key.strip() else None
    http_client = create_mcp_http_client(headers=headers) if headers else None
    if http_client is not None:
        await stack.enter_async_context(http_client)

    client_kwargs: dict[str, Any] = {"url": url}
    if http_client is not None:
        client_kwargs["http_client"] = http_client

    read, write, _ = await stack.enter_async_context(streamable_http_client(**client_kwargs))
    session: ClientSession = await stack.enter_async_context(ClientSession(read, write))
    await session.initialize()
    return session
