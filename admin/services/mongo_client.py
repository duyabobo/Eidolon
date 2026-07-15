import logging
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pi_shared import now_china

from config import settings
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
    db = get_db()
    from services import mcp_mongo

    await mcp_mongo.ensure_indexes(db)
    await mcp_mongo.migrate_legacy_config(db)
    from services import knowledge_config_store

    await knowledge_config_store.ensure_indexes(db)
    await db.skills.create_index(
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
    from services.mcp_mongo import list_system_config
    return await list_system_config(get_db())


async def save_mcp_config(cfg: McpConfig) -> None:
    db = get_db()
    from services.mcp_mongo import _meta_key, upsert_server

    cursor = db.mcp_servers.find(_system_user_filter())
    async for raw in cursor:
        await db.mcp_servers.delete_one(_meta_key(str(raw["name"]), None))
    for name, server in cfg.servers.items():
        await upsert_server(db, name, server, None)
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
    meta.updated_at = now_china()
    # created_at 仅在首次插入时写入（$setOnInsert），更新时不能同时出现在 $set 里，否则 MongoDB 报冲突
    set_data = {k: v for k, v in meta.model_dump().items() if k != "created_at"}
    await get_db()[_SKILL_COLLECTION].update_one(
        _meta_key(meta.name, meta.user_id),
        {"$set": set_data, "$setOnInsert": {"created_at": meta.created_at}},
        upsert=True,
    )
    logger.info("skill 元数据已保存 name=%s user_id=%s", meta.name, meta.user_id)
    return meta


async def list_user_session_meta(user_id: str) -> dict[str, dict[str, Any]]:
    """
    查询用户会话摘要，供 workspace sessions 列表展示名 enrichment。
    返回 {session_id: {"request": str, "created_at": datetime|None}}。
    """
    cursor = get_db()["sessions"].find(
        {"user_id": user_id},
        {"_id": 1, "request": 1, "created_at": 1},
    )
    result: dict[str, dict[str, Any]] = {}
    async for raw in cursor:
        sid = str(raw["_id"])
        result[sid] = {
            "request": str(raw.get("request") or ""),
            "created_at": raw.get("created_at"),
        }
    return result


async def get_chat_session_owner(session_id: str) -> str | None:
    """返回聊天 session 的 user_id；不存在则 None。"""
    raw = await get_db()["sessions"].find_one({"_id": session_id}, {"user_id": 1})
    if raw is None:
        return None
    return str(raw.get("user_id") or "") or None


async def append_chat_session_event(session_id: str, event: dict[str, Any]) -> None:
    """向聊天 session 的 events_snapshot 追加事件（与 gateway 格式一致）。"""
    await get_db()["sessions"].update_one(
        {"_id": session_id},
        {"$push": {"events_snapshot": event}},
    )
    logger.info(
        "session 事件已追加: session=%s type=%s",
        session_id,
        event.get("event_type"),
    )


async def delete_skill_meta(name: str, user_id: str | None = None) -> bool:
    result = await get_db()[_SKILL_COLLECTION].delete_one(_meta_key(name, user_id))
    if result.deleted_count:
        logger.info("skill 元数据已删除 name=%s user_id=%s", name, user_id or "system")
        return True
    return False
