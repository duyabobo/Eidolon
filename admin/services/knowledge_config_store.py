import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from constants.knowledge import (
    KNOWLEDGE_PLATFORM_SCENE_UID,
    KNOWLEDGE_SCENE_TYPE,
    MRAG_KEY_COLLECTION,
)
from models.knowledge import KnowledgeServiceConfig
from services.mongo_client import get_db

logger = logging.getLogger(__name__)

_COLLECTION = "knowledge_service_configs"


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[_COLLECTION].create_index([("created_at", -1)], name="knowledge_service_created_at_desc")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_base_url(url: str) -> str:
    """补全协议前缀；留空表示本地模式。"""
    trimmed = (url or "").strip()
    if not trimmed:
        return ""
    if "://" not in trimmed:
        return f"http://{trimmed}"
    return trimmed


def normalize_scene_uid(uid: str) -> str:
    return (uid or "").strip()


def _to_config(raw: dict | None) -> KnowledgeServiceConfig:
    if not raw:
        return KnowledgeServiceConfig(base_url="")
    scene_uid = normalize_scene_uid(str(raw.get("scene_uid", "")))
    return KnowledgeServiceConfig(
        base_url=normalize_base_url(str(raw.get("base_url", ""))),
        scene_uid=scene_uid,
        created_at=raw.get("created_at"),
    )


def effective_scene_uid(uid: str) -> str:
    return normalize_scene_uid(uid) or KNOWLEDGE_PLATFORM_SCENE_UID


async def invalidate_knowledge_key_cache(*scene_uids: str) -> int:
    """清除 mRAG knowledge_key 缓存，下次请求将重新调用 get_or_create。"""
    db = get_db()
    deleted = 0
    seen: set[str] = set()
    for raw_uid in scene_uids:
        uid = effective_scene_uid(raw_uid)
        if uid in seen:
            continue
        seen.add(uid)
        result = await db[MRAG_KEY_COLLECTION].delete_one({
            "scene_uid": uid,
            "scene_type": KNOWLEDGE_SCENE_TYPE,
        })
        deleted += result.deleted_count
    if deleted:
        logger.info("已清除 knowledge_key 缓存 count=%d uids=%s", deleted, sorted(seen))
    return deleted


async def resolve_scene_uid() -> str:
    """读取最新配置中的 scene_uid；未配置时使用平台默认值。"""
    return effective_scene_uid((await get_service_config()).scene_uid)


async def get_service_config() -> KnowledgeServiceConfig:
    raw = await get_db()[_COLLECTION].find_one({}, sort=[("created_at", -1)])
    return _to_config(raw)


async def save_service_config(cfg: KnowledgeServiceConfig) -> KnowledgeServiceConfig:
    now = _now()
    prev_cfg = await get_service_config()
    prev_uid = effective_scene_uid(prev_cfg.scene_uid)
    prev_base_url = normalize_base_url(prev_cfg.base_url)

    base_url = normalize_base_url(cfg.base_url)
    scene_uid = normalize_scene_uid(cfg.scene_uid)
    if not scene_uid:
        scene_uid = normalize_scene_uid(prev_cfg.scene_uid)
    new_uid = effective_scene_uid(scene_uid)

    if prev_uid != new_uid or prev_base_url != base_url:
        await invalidate_knowledge_key_cache(prev_uid, new_uid)

    doc = {
        "base_url": base_url,
        "scene_uid": scene_uid,
        "created_at": now,
    }
    await get_db()[_COLLECTION].insert_one(doc)
    logger.info(
        "知识库服务地址已新增记录 base_url=%s scene_uid=%s",
        doc["base_url"] or "(本地模式)",
        doc["scene_uid"] or "(未配置)",
    )
    return KnowledgeServiceConfig(
        base_url=doc["base_url"],
        scene_uid=doc["scene_uid"],
        created_at=now,
    )


async def is_remote_mode() -> bool:
    return bool((await get_service_config()).base_url)
