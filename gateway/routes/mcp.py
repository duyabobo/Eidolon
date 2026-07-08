import logging

from fastapi import APIRouter, HTTPException, Query, status

from models.mcp import McpServerCreateRequest, McpServerItem
from services import mcp_mongo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mcp", tags=["mcp"])


@router.get("", response_model=list[McpServerItem])
async def list_mcp(
    user_id: str | None = Query(None, description="用户 ID，合并展示系统与个人 MCP"),
) -> list[McpServerItem]:
    return await mcp_mongo.list_mcp_for_user(user_id)


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
    return await mcp_mongo.upsert_user_server(
        uid, name.strip(), body.url.strip(), body.description, body.enabled, body.api_key
    )


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
