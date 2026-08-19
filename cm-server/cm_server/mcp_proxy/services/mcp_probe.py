import asyncio
import logging
import time
from contextlib import AsyncExitStack
from dataclasses import asdict, dataclass

from cm_server.mcp_proxy.services.mcp_connection import open_mcp_session
from cm_server.mcp_proxy.services.mcp_server_store import McpServerEntry

logger = logging.getLogger(__name__)


@dataclass
class McpServerProbeResult:
    name: str
    scope: str
    url: str
    enabled: bool
    available: bool
    tool_count: int
    tools: list[str]
    error: str = ""
    latency_ms: int = 0
    skipped: bool = False


def _format_probe_error(exc: BaseException) -> str:
    """展开 ExceptionGroup / __cause__，避免只看到 TaskGroup 笼统信息。"""
    if isinstance(exc, BaseExceptionGroup):
        parts = [_format_probe_error(child) for child in exc.exceptions]
        return "; ".join(p for p in parts if p) or str(exc)

    msg = str(exc).strip() or type(exc).__name__
    cause = exc.__cause__ or exc.__context__
    if cause is not None and cause is not exc:
        nested = _format_probe_error(cause)
        if nested and nested not in msg:
            return f"{msg} | cause: {nested}"
    return msg


async def probe_mcp_server(server: McpServerEntry) -> McpServerProbeResult:
    if not server.enabled:
        return McpServerProbeResult(
            name=server.name,
            scope=server.scope,
            url=server.url,
            enabled=False,
            available=False,
            tool_count=0,
            tools=[],
            skipped=True,
            error="Server 已禁用",
        )

    started = time.monotonic()
    try:
        async with AsyncExitStack() as stack:
            session = await open_mcp_session(
                stack,
                server.url,
                server.api_key,
                transport=server.transport,
                command=server.command,
                args=server.args,
                cwd=server.cwd,
            )
            tools_result = await session.list_tools()
            tool_names = [tool.name for tool in tools_result.tools]
            latency_ms = int((time.monotonic() - started) * 1000)
            return McpServerProbeResult(
                name=server.name,
                scope=server.scope,
                url=server.url,
                enabled=True,
                available=True,
                tool_count=len(tool_names),
                tools=tool_names,
                latency_ms=latency_ms,
            )
    except Exception as exc:
        latency_ms = int((time.monotonic() - started) * 1000)
        error_text = _format_probe_error(exc)
        logger.warning(
            "MCP 探测失败 name=%s url=%s err=%s",
            server.name,
            server.url,
            error_text,
        )
        return McpServerProbeResult(
            name=server.name,
            scope=server.scope,
            url=server.url,
            enabled=True,
            available=False,
            tool_count=0,
            tools=[],
            error=error_text,
            latency_ms=latency_ms,
        )


async def probe_mcp_servers(servers: list[McpServerEntry]) -> list[dict]:
    if not servers:
        return []
    results = await asyncio.gather(*(probe_mcp_server(server) for server in servers))
    return [asdict(item) for item in results]
