import logging
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pi_shared import now_china

from models.config import McpConfig, McpServerConfig

logger = logging.getLogger(__name__)

_COLLECTION = "mcp_servers"
_LEGACY_DOC_ID = "mcp"


def _system_user_filter() -> dict[str, Any]:
    return {"$or": [{"user_id": None}, {"user_id": {"$exists": False}}]}


def _meta_key(name: str, user_id: str | None) -> dict[str, Any]:
    return {"name": name, "user_id": user_id}


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[_COLLECTION].create_index(
        [("user_id", 1), ("name", 1)],
        unique=True,
        name="mcp_user_name_unique",
    )


async def migrate_legacy_config(db: AsyncIOMotorDatabase) -> None:
    """将旧版 configs.mcp 单文档迁移到 mcp_servers 集合（幂等）。"""
    legacy = await db.configs.find_one({"_id": _LEGACY_DOC_ID})
    if not legacy or not isinstance(legacy.get("servers"), dict):
        return

    migrated = 0
    for name, cfg in legacy["servers"].items():
        if not isinstance(cfg, dict) or not cfg.get("url"):
            continue
        exists = await db[_COLLECTION].find_one(_meta_key(name, None))
        if exists:
            continue
        doc = {
            "name": name,
            "user_id": None,
            "url": cfg["url"],
            "description": cfg.get("description", ""),
            "enabled": cfg.get("enabled", True),
            "api_key": cfg.get("api_key", ""),
            "created_at": now_china(),
            "updated_at": now_china(),
        }
        await db[_COLLECTION].insert_one(doc)
        migrated += 1

    if migrated:
        logger.info("MCP 旧配置已迁移 %d 条到 mcp_servers", migrated)


async def list_system_config(db: AsyncIOMotorDatabase) -> McpConfig:
    servers: dict[str, McpServerConfig] = {}
    cursor = db[_COLLECTION].find(_system_user_filter())
    async for raw in cursor:
        servers[str(raw["name"])] = McpServerConfig(
            url=str(raw["url"]),
            description=str(raw.get("description") or ""),
            enabled=bool(raw.get("enabled", True)),
            api_key=str(raw.get("api_key") or ""),
        )
    return McpConfig(servers=servers)


async def upsert_server(
    db: AsyncIOMotorDatabase,
    name: str,
    cfg: McpServerConfig,
    user_id: str | None,
) -> None:
    now = now_china()
    existing = await db[_COLLECTION].find_one(_meta_key(name, user_id))
    api_key = cfg.api_key.strip()
    if not api_key and existing and existing.get("api_key"):
        api_key = str(existing["api_key"])

    await db[_COLLECTION].update_one(
        _meta_key(name, user_id),
        {
            "$set": {
                "name": name,
                "user_id": user_id,
                "url": cfg.url,
                "description": cfg.description,
                "enabled": cfg.enabled,
                "api_key": api_key,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )


async def delete_server(db: AsyncIOMotorDatabase, name: str, user_id: str | None) -> bool:
    result = await db[_COLLECTION].delete_one(_meta_key(name, user_id))
    return result.deleted_count > 0
