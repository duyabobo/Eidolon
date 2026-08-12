"""
MCP Proxy 路由：JSON-RPC 分发、缓存管理、Server 探测。
"""
import logging
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response

from cm_server.mcp_proxy.services import mcp_server_store
from cm_server.mcp_proxy.services.manager import manager
from cm_server.mcp_proxy.services.mcp_filter import parse_csv_names, parse_mcp_tools_header
from cm_server.mcp_proxy.services.mcp_probe import probe_mcp_servers
from cm_server.mcp_proxy.services.request_user import X_USER_ID_HEADER, request_user_context

logger = logging.getLogger(__name__)

router = APIRouter()

_PROTOCOL_VERSION = "2025-03-26"
_SERVER_INFO = {"name": "mcp-proxy", "version": "1.0.0"}

JsonRpcId = str | int | None


# ── JSON-RPC 工具函数 ─────────────────────────────────────────────────────────

def _jsonrpc_result(request_id: JsonRpcId, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _jsonrpc_error(request_id: JsonRpcId, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _inbound_user_id(request: Request) -> str | None:
    raw = request.headers.get(X_USER_ID_HEADER)
    return raw.strip() if raw and raw.strip() else None


# ── 路由 ─────────────────────────────────────────────────────────────────────

@router.post("/mcp", tags=["mcp"])
async def handle_mcp(request: Request) -> Response:
    user_id = _inbound_user_id(request)
    # 白名单是工具粒度（X-Mcp-Tools），不是 Server 粒度：见 mcp_cache_manager.get_tools
    allowed_tool_names = parse_mcp_tools_header(request.headers.get("X-Mcp-Tools"))
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(_jsonrpc_error(None, -32700, "Parse error"), status_code=400)

    with request_user_context(user_id):
        response = await _dispatch(body, user_id, allowed_tool_names)
    if response is None:
        return Response(status_code=202)
    return JSONResponse(response)


@router.post("/cache/invalidate", tags=["cache"])
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
        manager.invalidate_server(user_id, server_name.strip())
        logger.info("精确缓存失效 user=%s server=%s", user_id or "-", server_name)
    else:
        manager.invalidate_user(user_id)
        logger.info("全量缓存失效 user=%s", user_id or "-")
    return {"ok": True, "user_id": user_id, "server_name": server_name}


@router.get("/servers/status", tags=["mcp"])
async def servers_status(
    request: Request,
    include_disabled: bool = Query(False, description="是否包含已禁用的 Server"),
    name: str | None = Query(None, description="仅探测指定名称（单条，兼容旧接口）"),
    names: str | None = Query(None, description="逗号分隔的 Server 名称列表"),
    scope: str | None = Query(None, description="system 或 user，配合 name 使用"),
) -> dict:
    """探测 MCP Server 连通性并返回工具列表（不缓存，每次实时检测）。"""
    user_id = _inbound_user_id(request)
    parsed_names = parse_csv_names(names)
    if parsed_names:
        servers = await mcp_server_store.read_mcp_servers(
            user_id,
            include_disabled=include_disabled,
            names=parsed_names,
            scope=scope,
        )
    else:
        servers = await mcp_server_store.read_mcp_servers(
            user_id,
            include_disabled=include_disabled,
            name=name,
            scope=scope,
        )
    with request_user_context(user_id):
        items = await probe_mcp_servers(servers)

    # probe 完成后精确失效被探测的 Server，下次 tools/list 时重建其连接。
    # 系统级 Server 缓存归属 None（全局共享），不能按发起探测的 user_id 失效，
    # 否则会失效到一个从未存在的 (user_id, name) 缓存键，实际的系统级缓存不受影响。
    for item in items:
        owner = None if item["scope"] == "system" else user_id
        manager.invalidate_server(owner, item["name"])

    return {"servers": items}


# ── JSON-RPC 分发（内部）──────────────────────────────────────────────────────

async def _dispatch(body: dict, user_id: str | None, allowed_tool_names: list[str] | None) -> dict | None:
    request_id: JsonRpcId = body.get("id")
    method: str = body.get("method", "")
    params: dict = body.get("params") or {}

    tools_view = await manager.get_tools(user_id, allowed_tool_names)

    if method == "initialize":
        return _jsonrpc_result(request_id, {
            "protocolVersion": _PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": _SERVER_INFO,
        })

    if method == "tools/list":
        return _jsonrpc_result(request_id, {"tools": tools_view.list_tools()})

    if method == "tools/call":
        tool_name: str = params.get("name", "")
        tool_args: dict = params.get("arguments") or {}
        try:
            result = await tools_view.call_tool(tool_name, tool_args)
            return _jsonrpc_result(request_id, result)
        except ValueError as e:
            logger.error("tools/call 失败 user=%s tool=%s %s", user_id, tool_name, e)
            return _jsonrpc_error(request_id, -32603, str(e))

    if method.startswith("notifications/"):
        return None

    return _jsonrpc_error(request_id, -32601, f"Method not found: {method}")
