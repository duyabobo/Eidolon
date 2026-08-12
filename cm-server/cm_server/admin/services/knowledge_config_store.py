"""知识库服务配置（本地/远程环境切换）：CM 架构下替代原 Mongo 实现（Mongo → SQLite）。"""
import logging

from pi_shared import format_iso, now_china

from cm_server.admin.constants.knowledge import KNOWLEDGE_ENVIRONMENT_LABELS, knowledge_environment_urls
from cm_server.admin.models.knowledge import (
    KnowledgeEnvironment,
    KnowledgeEnvironmentList,
    KnowledgeEnvironmentOption,
    KnowledgeServiceConfig,
)
from cm_server.admin.services.db import get_db

logger = logging.getLogger(__name__)


def normalize_base_url(url: str) -> str:
    trimmed = (url or "").strip()
    if not trimmed:
        return ""
    if "://" not in trimmed:
        return f"http://{trimmed}"
    return trimmed.rstrip("/")


def resolve_environment_base_url(environment: KnowledgeEnvironment) -> str:
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
    if (
        "127.0.0.1" in normalized
        or "localhost" in normalized
        or "host.docker.internal" in normalized
    ):
        return "local"
    return "prod"


def list_environment_options() -> KnowledgeEnvironmentList:
    urls = knowledge_environment_urls()
    items = [
        KnowledgeEnvironmentOption(
            id="local",
            label=KNOWLEDGE_ENVIRONMENT_LABELS["local"],
            base_url=normalize_base_url(urls["local"]),
        ),
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


def _row_to_config(row: dict | None) -> KnowledgeServiceConfig:
    if not row:
        return KnowledgeServiceConfig(
            base_url=resolve_environment_base_url("local"),
            environment="local",
        )
    base_url = normalize_base_url(str(row.get("base_url", "")))
    environment_raw = str(row.get("environment") or "")
    if environment_raw in {"local", "prod", "test"}:
        environment = environment_raw  # type: ignore[assignment]
    else:
        environment = infer_environment(base_url)
    if not base_url:
        base_url = resolve_environment_base_url(environment)
    return KnowledgeServiceConfig(
        base_url=base_url,
        environment=environment,
        created_at=row.get("created_at"),
    )


async def get_service_config() -> KnowledgeServiceConfig:
    row = await get_db().fetch_one(
        "SELECT * FROM knowledge_service_configs ORDER BY created_at DESC LIMIT 1"
    )
    return _row_to_config(row)


async def save_service_config(cfg: KnowledgeServiceConfig) -> KnowledgeServiceConfig:
    now = now_china()
    environment = cfg.environment if cfg.environment in {"local", "prod", "test"} else "local"
    base_url = resolve_environment_base_url(environment)

    await get_db().execute(
        "INSERT INTO knowledge_service_configs (base_url, environment, created_at) VALUES (?, ?, ?)",
        (base_url, environment, format_iso(now)),
    )
    logger.info(
        "知识库服务配置已新增 env=%s base_url=%s",
        environment,
        base_url or "(未配置地址)",
    )
    return KnowledgeServiceConfig(base_url=base_url, environment=environment, created_at=now)


async def is_remote_mode() -> bool:
    return bool((await get_service_config()).base_url)
