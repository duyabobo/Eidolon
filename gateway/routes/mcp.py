import logging

from fastapi import APIRouter, HTTPException, Query, status

from models.mcp import McpScope, McpServerCreateRequest, McpServerItem, McpServerStatusItem, McpServerStatusResponse
from services import mcp_mongo
from services.mcp_proxy_client import fetch_server_status, invalidate_cache, probe_single_server

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mcp", tags=["mcp"])


@router.get("", response_model=list[McpServerItem])
async def list_mcp(
    user_id: str | None = Query(None, description="用户 ID，合并展示系统与个人 MCP"),
    include_disabled: bool = Query(False, description="配置页展示全部 Server（含已禁用）"),
) -> list[McpServerItem]:
    return await mcp_mongo.list_mcp_for_user(user_id, include_disabled=include_disabled)


@router.get("/status", response_model=McpServerStatusResponse)
async def mcp_servers_status(
    user_id: str | None = Query(None, description="用户 ID，合并探测系统与个人 MCP"),
    include_disabled: bool = Query(False, description="是否探测已禁用的 Server"),
) -> McpServerStatusResponse:
    # probe 完成后 mcp-proxy 侧会自动失效缓存（见 mcp-proxy/main.py /servers/status）
    return await fetch_server_status(user_id, include_disabled=include_disabled)


@router.get("/servers/{name}/status", response_model=McpServerStatusItem)
async def mcp_server_status(
    name: str,
    scope: McpScope = Query(..., description="system 或 user"),
    user_id: str | None = Query(None, description="用户 ID（user scope 必填）"),
) -> McpServerStatusItem:
    if scope == McpScope.USER and not (user_id and user_id.strip()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="user scope 需要 user_id")

    # probe 完成后 mcp-proxy 侧会自动失效缓存
    return await probe_single_server(user_id, name.strip(), scope)


@router.post("/servers/{name}", response_model=McpServerItem)
async def add_user_mcp_server(
    name: str,
    body: McpServerCreateRequest,
    user_id: str = Query(..., description="用户 ID"),
) -> McpServerItem:
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="user_id 不能为空")
    if not name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="名称不能为空")
    result = await mcp_mongo.upsert_user_server(
        uid, name.strip(), body.url.strip(), body.description, body.enabled, body.api_key
    )
    await invalidate_cache(uid, name.strip())  # 精确失效该 Server
    return result


@router.delete("/servers/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_mcp_server(
    name: str,
    user_id: str = Query(..., description="用户 ID"),
) -> None:
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="user_id 不能为空")
    deleted = await mcp_mongo.delete_user_server(uid, name.strip())
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"MCP server '{name}' 不存在")
    await invalidate_cache(uid, name.strip())  # 精确失效该 Server
