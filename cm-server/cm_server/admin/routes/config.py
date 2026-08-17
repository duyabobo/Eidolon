import logging

from fastapi import APIRouter, HTTPException, status

from pydantic import BaseModel

from cm_server.admin.models.config import McpConfig, McpServerConfig
from cm_server.admin.services.mcp_proxy_client import invalidate_cache
from cm_server.admin.services.mcp_server_store import delete_server, list_system_config, replace_all_servers, upsert_server
from cm_server.shared.machine_uid import get_machine_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config", tags=["config"])


class DeviceInfo(BaseModel):
    user_id: str


@router.get("/device", response_model=DeviceInfo)
async def get_device_info() -> DeviceInfo:
    return DeviceInfo(user_id=await get_machine_user_id())


# ── MCP 配置（系统级，user_id 为空）──────────────────────────────────────────

@router.get("/mcp", response_model=McpConfig)
async def get_mcp_config() -> McpConfig:
    """读取系统 MCP Server 列表（本地 SQLite mcp_servers 表）"""
    return await list_system_config()


@router.put("/mcp", response_model=McpConfig)
async def update_mcp_config(body: McpConfig) -> McpConfig:
    """全量替换系统 MCP 配置"""
    await replace_all_servers(body.servers)
    logger.info("系统 MCP 配置已全量替换，共 %d 个 server", len(body.servers))
    await invalidate_cache(None)
    return body


@router.post("/mcp/servers/{name}", response_model=McpConfig)
async def add_or_update_mcp_server(name: str, body: McpServerConfig) -> McpConfig:
    await upsert_server(name, body)
    logger.info("系统 MCP server 已添加/更新: %s", name)
    await invalidate_cache(None, name)  # 精确失效该 Server
    return await list_system_config()


@router.delete("/mcp/servers/{name}", response_model=McpConfig)
async def delete_mcp_server(name: str) -> McpConfig:
    deleted = await delete_server(name)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"MCP server '{name}' 不存在")
    logger.info("系统 MCP server 已删除: %s", name)
    await invalidate_cache(None, name)  # 精确失效该 Server
    return await list_system_config()
