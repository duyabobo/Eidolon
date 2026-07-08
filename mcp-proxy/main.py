"""
mcp-proxy 入口：按 X-User-Id 加载系统 + 个人 MCP Server。
"""
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse, Response

from config import settings
from logger import setup_logging
from services import mongo_client
from services.aggregator_manager import McpAggregatorManager
from services.mcp_probe import probe_mcp_servers

setup_logging("mcp-proxy")
logger = logging.getLogger(__name__)

_manager = McpAggregatorManager(settings.tool_refresh_interval_s)

_PROTOCOL_VERSION = "2025-03-26"
_SERVER_INFO = {"name": "mcp-proxy", "version": "1.0.0"}

JsonRpcId = str | int | None


def _jsonrpc_result(request_id: JsonRpcId, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _jsonrpc_error(request_id: JsonRpcId, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


async def _dispatch(body: dict, user_id: str | None) -> dict | None:
    request_id: JsonRpcId = body.get("id")
    method: str = body.get("method", "")
    params: dict = body.get("params") or {}

    servers = await mongo_client.read_enabled_mcp_servers(user_id)
    aggregator = await _manager.refresh_if_stale(user_id, servers)

    if method == "initialize":
        return _jsonrpc_result(request_id, {
            "protocolVersion": _PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": _SERVER_INFO,
        })

    if method == "tools/list":
        return _jsonrpc_result(request_id, {"tools": aggregator.list_tools()})

    if method == "tools/call":
        tool_name: str = params.get("name", "")
        tool_args: dict = params.get("arguments") or {}
        try:
            result = await aggregator.call_tool(tool_name, tool_args)
            return _jsonrpc_result(request_id, result)
        except ValueError as e:
            logger.error("tools/call 失败 user=%s tool=%s %s", user_id, tool_name, e)
            return _jsonrpc_error(request_id, -32603, str(e))

    if method.startswith("notifications/"):
        return None

    return _jsonrpc_error(request_id, -32601, f"Method not found: {method}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("mcp-proxy 启动中...")
    await mongo_client.connect()
    servers = await mongo_client.read_enabled_mcp_servers(None)
    await _manager.refresh_if_stale(None, servers)
    logger.info("mcp-proxy 启动完成，监听端口 %d", settings.mcp_proxy_port)
    yield
    logger.info("mcp-proxy 关闭中...")
    await _manager.close_all()
    await mongo_client.disconnect()


app = FastAPI(title="MCP Proxy", version="1.0.0", lifespan=lifespan)


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "ok"}


@app.get("/servers/status", tags=["mcp"])
async def servers_status(
    request: Request,
    include_disabled: bool = Query(False, description="是否包含已禁用的 Server"),
    name: str | None = Query(None, description="仅探测指定名称"),
    scope: str | None = Query(None, description="system 或 user，配合 name 使用"),
) -> dict:
    """探测 MCP Server 连通性并返回工具列表（不缓存，每次实时检测）。"""
    user_id = request.headers.get("X-User-Id") or None
    servers = await mongo_client.read_mcp_servers(
        user_id,
        include_disabled=include_disabled,
        name=name,
        scope=scope,
    )
    items = await probe_mcp_servers(servers)
    return {"servers": items}


@app.post("/mcp", tags=["mcp"])
async def handle_mcp(request: Request) -> Response:
    user_id = request.headers.get("X-User-Id") or None
    try:
        body = await request.json()
    except Exception:
        error = _jsonrpc_error(None, -32700, "Parse error")
        return JSONResponse(error, status_code=400)

    response = await _dispatch(body, user_id)
    if response is None:
        return Response(status_code=202)
    return JSONResponse(response)
