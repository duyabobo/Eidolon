import logging

from fastapi import APIRouter, HTTPException, status

from models.config import McpConfig, McpServerConfig
from services import mongo_client
from services.mcp_mongo import delete_server, list_system_config, upsert_server
from services.mcp_proxy_client import invalidate_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config", tags=["config"])


# ── MCP 配置（系统级，user_id 为空）──────────────────────────────────────────

@router.get("/mcp", response_model=McpConfig)
async def get_mcp_config() -> McpConfig:
    """读取系统 MCP Server 列表（MongoDB mcp_servers 集合）"""
    return await list_system_config(mongo_client.get_db())


@router.put("/mcp", response_model=McpConfig)
async def update_mcp_config(body: McpConfig) -> McpConfig:
    """全量替换系统 MCP 配置"""
    db = mongo_client.get_db()
    from services.mcp_mongo import _meta_key

    cursor = db.mcp_servers.find({"$or": [{"user_id": None}, {"user_id": {"$exists": False}}]})
    async for raw in cursor:
        await db.mcp_servers.delete_one(_meta_key(str(raw["name"]), None))

    for name, cfg in body.servers.items():
        await upsert_server(db, name, cfg, None)
    logger.info("系统 MCP 配置已全量替换，共 %d 个 server", len(body.servers))
    await invalidate_cache(None)
    return body


@router.post("/mcp/servers/{name}", response_model=McpConfig)
async def add_or_update_mcp_server(name: str, body: McpServerConfig) -> McpConfig:
    await upsert_server(mongo_client.get_db(), name, body, None)
    logger.info("系统 MCP server 已添加/更新: %s", name)
    await invalidate_cache(None, name)  # 精确失效该 Server
    return await list_system_config(mongo_client.get_db())


@router.delete("/mcp/servers/{name}", response_model=McpConfig)
async def delete_mcp_server(name: str) -> McpConfig:
    deleted = await delete_server(mongo_client.get_db(), name, None)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"MCP server '{name}' 不存在")
    logger.info("系统 MCP server 已删除: %s", name)
    await invalidate_cache(None, name)  # 精确失效该 Server
    return await list_system_config(mongo_client.get_db())
