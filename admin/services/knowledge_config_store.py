import logging
from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorDatabase
from pi_shared import now_china

from constants.knowledge import KNOWLEDGE_ENVIRONMENT_LABELS, knowledge_environment_urls
from models.knowledge import (
    KnowledgeEnvironment,
    KnowledgeEnvironmentList,
    KnowledgeEnvironmentOption,
    KnowledgeServiceConfig,
)
from services.mongo_client import get_db

logger = logging.getLogger(__name__)

_COLLECTION = "knowledge_service_configs"


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[_COLLECTION].create_index([("created_at", -1)], name="knowledge_service_created_at_desc")


def _now() -> datetime:
    return now_china()


def normalize_base_url(url: str) -> str:
    trimmed = (url or "").strip()
    if not trimmed:
        return ""
    if "://" not in trimmed:
        return f"http://{trimmed}"
    return trimmed.rstrip("/")


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
    if "38026" in normalized or "1.92.211.130" in normalized:
        return "test"
    if "scienceone.cn" in normalized:
        return "prod"
    return "prod"


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
        created_at=raw.get("created_at"),
    )


async def get_service_config() -> KnowledgeServiceConfig:
    raw = await get_db()[_COLLECTION].find_one({}, sort=[("created_at", -1)])
    return _to_config(raw)


async def save_service_config(cfg: KnowledgeServiceConfig) -> KnowledgeServiceConfig:
    now = _now()
    environment = cfg.environment if cfg.environment in {"local", "prod", "test"} else "local"
    base_url = resolve_environment_base_url(environment) if environment != "local" else ""

    doc = {
        "base_url": base_url,
        "environment": environment,
        "created_at": now,
    }
    await get_db()[_COLLECTION].insert_one(doc)
    logger.info(
        "知识库服务配置已新增 env=%s base_url=%s",
        environment,
        doc["base_url"] or "(本地模式)",
    )
    return KnowledgeServiceConfig(
        base_url=doc["base_url"],
        environment=environment,
        created_at=now,
    )


async def is_remote_mode() -> bool:
    return bool((await get_service_config()).base_url)
