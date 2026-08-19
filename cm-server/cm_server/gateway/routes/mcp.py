from fastapi import APIRouter, HTTPException, Query, status

from cm_server.gateway.models.mcp import McpScope, McpServerCreateRequest, McpServerItem, McpServerStatusItem, McpServerStatusResponse
from cm_server.gateway.services import mcp_store
from cm_server.gateway.services.mcp_proxy_client import fetch_server_status, invalidate_cache, probe_single_server
from cm_server.shared.machine_uid import current_user_id

router = APIRouter(prefix="/mcp", tags=["mcp"])


@router.get("", response_model=list[McpServerItem])
async def list_mcp(
    include_disabled: bool = Query(False, description="配置页展示全部 Server（含已禁用）"),
) -> list[McpServerItem]:
    return await mcp_store.list_mcp_for_user(await current_user_id(), include_disabled=include_disabled)


@router.get("/status", response_model=McpServerStatusResponse)
async def mcp_servers_status(
    include_disabled: bool = Query(False, description="是否探测已禁用的 Server"),
) -> McpServerStatusResponse:
    return await fetch_server_status(await current_user_id(), include_disabled=include_disabled)


@router.get("/servers/{name}/status", response_model=McpServerStatusItem)
async def mcp_server_status(
    name: str,
    scope: McpScope = Query(..., description="system 或 user"),
) -> McpServerStatusItem:
    owner_id = await current_user_id() if scope == McpScope.USER else None
    return await probe_single_server(owner_id, name.strip(), scope)


@router.post("/servers/{name}", response_model=McpServerItem)
async def add_user_mcp_server(
    name: str,
    body: McpServerCreateRequest,
) -> McpServerItem:
    if not name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="名称不能为空")
    uid = await current_user_id()
    result = await mcp_store.upsert_user_server(
        uid,
        name.strip(),
        body.url.strip(),
        body.description,
        body.enabled,
        body.api_key,
        transport=body.transport,
        command=body.command,
        args=body.args,
        cwd=body.cwd,
    )
    await invalidate_cache(uid, name.strip())
    return result


@router.delete("/servers/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_mcp_server(name: str) -> None:
    uid = await current_user_id()
    deleted = await mcp_store.delete_user_server(uid, name.strip())
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"MCP server '{name}' 不存在")
    await invalidate_cache(uid, name.strip())
