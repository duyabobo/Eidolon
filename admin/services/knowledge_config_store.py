import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

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


def _to_config(raw: dict | None) -> KnowledgeServiceConfig:
    if not raw:
        return KnowledgeServiceConfig(base_url="")
    return KnowledgeServiceConfig(
        base_url=normalize_base_url(str(raw.get("base_url", ""))),
        created_at=raw.get("created_at"),
    )


async def get_service_config() -> KnowledgeServiceConfig:
    raw = await get_db()[_COLLECTION].find_one({}, sort=[("created_at", -1)])
    return _to_config(raw)


async def save_service_config(cfg: KnowledgeServiceConfig) -> KnowledgeServiceConfig:
    now = _now()
    base_url = normalize_base_url(cfg.base_url)
    doc = {
        "base_url": base_url,
        "created_at": now,
    }
    await get_db()[_COLLECTION].insert_one(doc)
    logger.info("知识库服务地址已新增记录 base_url=%s", doc["base_url"] or "(本地模式)")
    return KnowledgeServiceConfig(base_url=doc["base_url"], created_at=now)


async def is_remote_mode() -> bool:
    return bool((await get_service_config()).base_url)
