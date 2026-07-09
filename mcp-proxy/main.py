"""
mcp-proxy 入口：按 X-User-Id 加载系统 + 个人 MCP Server。
支持 X-Mcp-Servers 头按 Skill 声明的 Server 子集过滤 tools/list 与 tools/call。

缓存策略（统一 TTL = 300s）：
  - 正常请求：命中缓存直接返回，TTL 内不重建
  - 强制失效时机（下次请求触发重建）：
      1. add / delete MCP Server 配置变更时（per-server 精确失效）
      2. 手动 probe（/servers/status）后（per-server 精确失效）
      3. 系统配置全量替换时（全量失效）
  - 系统重启：预热系统 MCP + 后台并行预热所有用户 MCP
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse, Response

from config import settings
from logger import setup_logging
from services import mongo_client
from services.aggregator_manager import McpAggregatorManager
from services.mcp_filter import parse_csv_names, parse_mcp_server_header
from services.mcp_probe import probe_mcp_servers

setup_logging("mcp-proxy")
logger = logging.getLogger(__name__)

_manager = McpAggregatorManager(refresh_interval_s=settings.tool_refresh_interval_s)

_PROTOCOL_VERSION = "2025-03-26"
_SERVER_INFO = {"name": "mcp-proxy", "version": "1.0.0"}

JsonRpcId = str | int | None


def _jsonrpc_result(request_id: JsonRpcId, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _jsonrpc_error(request_id: JsonRpcId, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _resolve_server_names(
    header_names: list[str] | None,
    query_names: list[str] | None,
) -> list[str] | None:
    """合并 X-Mcp-Servers 与查询参数；返回 None 表示加载全部已启用 Server。"""
    merged: list[str] = []
    seen: set[str] = set()
    for name in (header_names or []) + (query_names or []):
        cleaned = name.strip()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            merged.append(cleaned)
    return sorted(merged) if merged else None


async def _dispatch(body: dict, user_id: str | None, allowed_names: list[str] | None) -> dict | None:
    request_id: JsonRpcId = body.get("id")
    method: str = body.get("method", "")
    params: dict = body.get("params") or {}

    aggregator = await _manager.get_aggregator(user_id, allowed_names)

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


async def _preload_all_users_background() -> None:
    """后台并行预热所有用户的全量 MCP 工具列表（系统重启时触发）。"""
    try:
        user_ids = await mongo_client.list_user_ids_with_mcp()
        logger.info("启动预热：发现 %d 个有 MCP 配置的用户", len(user_ids))

        await asyncio.gather(
            *(_manager.force_refresh(uid) for uid in user_ids),
            return_exceptions=True,
        )
        logger.info("所有用户 MCP 预热完毕")
    except Exception as exc:
        logger.error("启动预热失败: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("mcp-proxy 启动中...")
    await mongo_client.connect()

    # 同步预热系统 MCP（阻塞启动，确保就绪）
    await _manager.force_refresh(None)
    logger.info("mcp-proxy 启动完成，监听端口 %d", settings.mcp_proxy_port)

    # 后台预热所有用户 MCP（不阻塞启动）
    asyncio.create_task(_preload_all_users_background())

    yield

    logger.info("mcp-proxy 关闭中...")
    await _manager.close_all()
    await mongo_client.disconnect()


app = FastAPI(title="MCP Proxy", version="1.0.0", lifespan=lifespan)


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "ok"}


@app.post("/cache/invalidate", tags=["cache"])
async def invalidate_cache(
    user_id: str | None = Query(None, description="要失效的用户 ID；为空则失效系统级缓存"),
    server_name: str | None = Query(None, description="精确失效某个 Server；为空则全量失效该用户所有 Server"),
) -> dict:
    """
    主动失效 MCP 工具列表缓存。

    - 指定 server_name：per-server 精确失效，其他 Server 缓存不受影响
    - 不指定 server_name：全量失效该用户所有 Server（用于全量配置替换）
    """
    if server_name and server_name.strip():
        _manager.invalidate_server(user_id, server_name.strip())
        logger.info("精确缓存失效 user=%s server=%s", user_id or "-", server_name)
    else:
        _manager.invalidate_user(user_id)
        logger.info("全量缓存失效 user=%s", user_id or "-")
    return {"ok": True, "user_id": user_id, "server_name": server_name}


@app.get("/servers/status", tags=["mcp"])
async def servers_status(
    request: Request,
    include_disabled: bool = Query(False, description="是否包含已禁用的 Server"),
    name: str | None = Query(None, description="仅探测指定名称（单条，兼容旧接口）"),
    names: str | None = Query(None, description="逗号分隔的 Server 名称列表"),
    scope: str | None = Query(None, description="system 或 user，配合 name 使用"),
) -> dict:
    """探测 MCP Server 连通性并返回工具列表（不缓存，每次实时检测）。"""
    user_id = request.headers.get("X-User-Id") or None
    parsed_names = parse_csv_names(names)
    if parsed_names:
        servers = await mongo_client.read_mcp_servers(
            user_id,
            include_disabled=include_disabled,
            names=parsed_names,
            scope=scope,
        )
    else:
        servers = await mongo_client.read_mcp_servers(
            user_id,
            include_disabled=include_disabled,
            name=name,
            scope=scope,
        )
    items = await probe_mcp_servers(servers)

    # probe 完成后精确失效被探测的 Server，下次 tools/list 时重建其连接
    for item in items:
        _manager.invalidate_server(user_id, item["name"])

    return {"servers": items}


@app.post("/mcp", tags=["mcp"])
async def handle_mcp(request: Request) -> Response:
    user_id = request.headers.get("X-User-Id") or None
    allowed_names = _resolve_server_names(
        parse_mcp_server_header(request.headers.get("X-Mcp-Servers")),
        None,
    )
    try:
        body = await request.json()
    except Exception:
        error = _jsonrpc_error(None, -32700, "Parse error")
        return JSONResponse(error, status_code=400)

    response = await _dispatch(body, user_id, allowed_names)
    if response is None:
        return Response(status_code=202)
    return JSONResponse(response)
