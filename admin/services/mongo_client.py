import logging
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from config import settings
from datetime import datetime
from models.config import McpConfig, SkillMeta

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None

_CONFIG_COLLECTION = "configs"
_MCP_DOC_ID = "mcp"
_SKILL_COLLECTION = "skills"


def get_db() -> AsyncIOMotorDatabase:
    if _client is None:
        raise RuntimeError("MongoDB 客户端未初始化")
    return _client[settings.mongo_db]


def _system_user_filter() -> dict[str, Any]:
    return {"$or": [{"user_id": None}, {"user_id": {"$exists": False}}]}


def _meta_key(name: str, user_id: str | None = None) -> dict[str, Any]:
    return {"name": name, "user_id": user_id}


async def connect() -> None:
    global _client
    _client = AsyncIOMotorClient(settings.mongo_uri)
    await _client[settings.mongo_db][_SKILL_COLLECTION].create_index(
        [("user_id", 1), ("name", 1)],
        unique=True,
        name="skill_user_name_unique",
    )
    logger.info("admin MongoDB 已连接: %s", settings.mongo_uri)


async def disconnect() -> None:
    global _client
    if _client:
        _client.close()
        _client = None


async def get_mcp_config() -> McpConfig:
    raw = await get_db()[_CONFIG_COLLECTION].find_one({"_id": _MCP_DOC_ID})
    if not raw:
        return McpConfig()
    raw.pop("_id", None)
    return McpConfig(**raw)


async def save_mcp_config(cfg: McpConfig) -> None:
    await get_db()[_CONFIG_COLLECTION].update_one(
        {"_id": _MCP_DOC_ID},
        {"$set": cfg.model_dump()},
        upsert=True,
    )
    logger.info("MCP 配置已保存，共 %d 个 server", len(cfg.servers))


# ── Skill 管理（系统 Skill，user_id 为空）────────────────────────────────────

async def list_skill_metas() -> list[SkillMeta]:
    cursor = get_db()[_SKILL_COLLECTION].find(_system_user_filter())
    docs = []
    async for raw in cursor:
        raw.pop("_id", None)
        docs.append(SkillMeta(**raw))
    return docs


async def save_skill_meta(meta: SkillMeta) -> SkillMeta:
    meta.updated_at = datetime.utcnow()
    await get_db()[_SKILL_COLLECTION].update_one(
        _meta_key(meta.name, meta.user_id),
        {"$set": meta.model_dump(), "$setOnInsert": {"created_at": meta.created_at}},
        upsert=True,
    )
    logger.info("skill 元数据已保存 name=%s user_id=%s", meta.name, meta.user_id)
    return meta


async def delete_skill_meta(name: str) -> bool:
    result = await get_db()[_SKILL_COLLECTION].delete_one(_meta_key(name, None))
    if result.deleted_count:
        logger.info("skill 元数据已删除 name=%s (system)", name)
        return True
    return False
