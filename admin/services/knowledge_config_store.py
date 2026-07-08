import logging
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from constants.knowledge import (
    KNOWLEDGE_ENVIRONMENT_LABELS,
    KNOWLEDGE_PLATFORM_SCENE_UID,
    knowledge_environment_urls,
)
from models.knowledge import (
    KnowledgeEnvironment,
    KnowledgeEnvironmentList,
    KnowledgeEnvironmentOption,
    KnowledgeServiceConfig,
    KnowledgeServiceConfigHistoryItem,
    KnowledgeServiceConfigHistoryList,
)
from services.mongo_client import get_db

logger = logging.getLogger(__name__)

_COLLECTION = "knowledge_service_configs"


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[_COLLECTION].create_index([("created_at", -1)], name="knowledge_service_created_at_desc")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_base_url(url: str) -> str:
    trimmed = (url or "").strip()
    if not trimmed:
        return ""
    if "://" not in trimmed:
        return f"http://{trimmed}"
    return trimmed.rstrip("/")


def normalize_scene_uid(uid: str) -> str:
    return (uid or "").strip()


def effective_scene_uid(uid: str) -> str:
    return normalize_scene_uid(uid) or KNOWLEDGE_PLATFORM_SCENE_UID


def resolve_environment_base_url(environment: KnowledgeEnvironment) -> str:
    if environment == "local":
        return ""
    urls = knowledge_environment_urls()
    return normalize_base_url(urls.get(environment, ""))


def infer_environment(base_url: str) -> KnowledgeEnvironment:
    normalized = normalize_base_url(base_url)
    if not normalized:
        return "local"
    urls = knowledge_environment_urls()
    for env_id, env_url in urls.items():
        if normalized == normalize_base_url(env_url):
            return env_id  # type: ignore[return-value]
    return "test" if "38026" in normalized else "prod"


def list_environment_options() -> KnowledgeEnvironmentList:
    urls = knowledge_environment_urls()
    items = [
        KnowledgeEnvironmentOption(id="local", label=KNOWLEDGE_ENVIRONMENT_LABELS["local"], base_url=""),
        KnowledgeEnvironmentOption(
            id="prod",
            label=KNOWLEDGE_ENVIRONMENT_LABELS["prod"],
            base_url=normalize_base_url(urls["prod"]),
        ),
        KnowledgeEnvironmentOption(
            id="test",
            label=KNOWLEDGE_ENVIRONMENT_LABELS["test"],
            base_url=normalize_base_url(urls["test"]),
        ),
    ]
    return KnowledgeEnvironmentList(items=items)


def _to_config(raw: dict | None) -> KnowledgeServiceConfig:
    if not raw:
        return KnowledgeServiceConfig(base_url="")
    base_url = normalize_base_url(str(raw.get("base_url", "")))
    environment_raw = str(raw.get("environment") or "")
    if environment_raw in {"local", "prod", "test"}:
        environment = environment_raw  # type: ignore[assignment]
    else:
        environment = infer_environment(base_url)
    if environment != "local" and not base_url:
        base_url = resolve_environment_base_url(environment)
    return KnowledgeServiceConfig(
        base_url=base_url,
        environment=environment,
        scene_uid=normalize_scene_uid(str(raw.get("scene_uid", ""))),
        created_at=raw.get("created_at"),
    )


async def resolve_scene_uid() -> str:
    return effective_scene_uid((await get_service_config()).scene_uid)


async def get_service_config() -> KnowledgeServiceConfig:
    raw = await get_db()[_COLLECTION].find_one({}, sort=[("created_at", -1)])
    return _to_config(raw)


async def list_service_config_history(limit: int = 20) -> KnowledgeServiceConfigHistoryList:
    cursor = get_db()[_COLLECTION].find({}).sort("created_at", -1).limit(limit)
    items: list[KnowledgeServiceConfigHistoryItem] = []
    async for raw in cursor:
        cfg = _to_config(raw)
        if not cfg.created_at:
            continue
        items.append(KnowledgeServiceConfigHistoryItem(
            id=str(raw["_id"]),
            base_url=cfg.base_url,
            environment=cfg.environment,
            scene_uid=cfg.scene_uid,
            created_at=cfg.created_at,
        ))
    return KnowledgeServiceConfigHistoryList(items=items)


async def save_service_config(cfg: KnowledgeServiceConfig) -> KnowledgeServiceConfig:
    now = _now()
    prev_cfg = await get_service_config()

    environment = cfg.environment if cfg.environment in {"local", "prod", "test"} else "local"
    base_url = resolve_environment_base_url(environment) if environment != "local" else ""
    scene_uid = normalize_scene_uid(cfg.scene_uid)
    if not scene_uid:
        scene_uid = normalize_scene_uid(prev_cfg.scene_uid)

    doc = {
        "base_url": base_url,
        "environment": environment,
        "scene_uid": scene_uid,
        "created_at": now,
    }
    await get_db()[_COLLECTION].insert_one(doc)
    logger.info(
        "知识库服务配置已新增 env=%s base_url=%s scene_uid=%s",
        environment,
        doc["base_url"] or "(本地模式)",
        doc["scene_uid"] or "(未配置)",
    )
    return KnowledgeServiceConfig(
        base_url=doc["base_url"],
        environment=environment,
        scene_uid=doc["scene_uid"],
        created_at=now,
    )


async def is_remote_mode() -> bool:
    return bool((await get_service_config()).base_url)
