import logging

from config import settings
from models.config import LlmConfig, LlmProfile
from services import mongo_client

logger = logging.getLogger(__name__)

_current: LlmConfig | None = None


def _env_defaults() -> LlmConfig:
    return LlmConfig(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        timeout=settings.llm_timeout,
    )


def _profile_to_config(profile: LlmProfile) -> LlmConfig:
    return LlmConfig(
        base_url=profile.base_url,
        api_key=profile.api_key,
        model=profile.model,
        timeout=profile.timeout,
        protocol=profile.protocol,
    )


async def load_from_db() -> None:
    """启动时调用，从 MongoDB 加载当前选中的 LLM 配置到内存"""
    global _current
    await mongo_client.migrate_legacy_llm_config()
    active = await mongo_client.get_active_llm_profile()
    if active:
        _current = _profile_to_config(active)
        logger.info("LLM 配置已从 DB 加载: profile=%s model=%s", active.name, active.model)
        return
    _current = _env_defaults()
    logger.info("DB 无 LLM 配置项，使用环境变量默认值: model=%s", _current.model)


def get_effective_config() -> LlmConfig:
    return _current or _env_defaults()


async def activate_profile(profile_id: str) -> LlmConfig:
    profile = await mongo_client.get_llm_profile(profile_id)
    if not profile:
        raise ValueError(f"LLM 配置不存在: {profile_id}")
    await mongo_client.set_active_llm_profile(profile_id)
    cfg = _profile_to_config(profile)
    update_in_memory(cfg)
    return cfg


def update_in_memory(cfg: LlmConfig) -> None:
    global _current
    _current = cfg
    logger.info("LLM 配置已热更新（内存）: model=%s base_url=%s", cfg.model, cfg.base_url)
