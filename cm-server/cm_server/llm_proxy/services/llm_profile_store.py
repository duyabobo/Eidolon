"""LLM Provider 配置项存储：CM 架构下替代原 llm-proxy/services/mongo_client.py 中的 LLM 配置部分。"""
import logging
import uuid

from pi_shared import format_iso, now_china

from cm_server.llm_proxy.models.config import LlmConfig, LlmProfile, LlmProfileCreate, LlmProfileUpdate
from cm_server.llm_proxy.services.db import get_db

logger = logging.getLogger(__name__)

_LEGACY_CONFIG_KEY = "llm"
_ACTIVE_PROFILE_KEY = "llm_active_profile_id"


def _to_profile(row: dict) -> LlmProfile:
    return LlmProfile(
        id=row["id"],
        name=row["name"],
        base_url=row["base_url"],
        api_key=row["api_key"],
        model=row["model"],
        timeout=row["timeout"],
        protocol=row["protocol"],
    )


async def get_legacy_llm_config() -> LlmConfig | None:
    """读取升级前遗留的单例 LLM 配置（`app_config` 表 key=llm），供首次启动迁移用。"""
    row = await get_db().fetch_one("SELECT value FROM app_config WHERE key = ?", (_LEGACY_CONFIG_KEY,))
    if not row:
        return None
    from pi_shared.sqlite import loads
    return LlmConfig(**loads(row["value"]))


async def list_llm_profiles() -> tuple[list[LlmProfile], str | None]:
    rows = await get_db().fetch_all("SELECT * FROM llm_profiles ORDER BY name ASC")
    items = [_to_profile(row) for row in rows]
    state = await get_db().fetch_one("SELECT value FROM app_config WHERE key = ?", (_ACTIVE_PROFILE_KEY,))
    active_id = state["value"] if state else None
    return items, active_id


async def get_llm_profile(profile_id: str) -> LlmProfile | None:
    row = await get_db().fetch_one("SELECT * FROM llm_profiles WHERE id = ?", (profile_id,))
    return _to_profile(row) if row else None


async def create_llm_profile(body: LlmProfileCreate) -> LlmProfile:
    profile_id = str(uuid.uuid4())
    await get_db().execute(
        """
        INSERT INTO llm_profiles (id, name, base_url, api_key, model, timeout, protocol)
        VALUES (:id, :name, :base_url, :api_key, :model, :timeout, :protocol)
        """,
        {"id": profile_id, **body.model_dump()},
    )
    logger.info("LLM 配置项已创建 id=%s name=%s", profile_id, body.name)
    return LlmProfile(id=profile_id, **body.model_dump())


async def update_llm_profile(profile_id: str, body: LlmProfileUpdate) -> LlmProfile | None:
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        return await get_llm_profile(profile_id)
    set_clause = ", ".join(f"{key} = :{key}" for key in patch)
    cursor = await get_db().execute(
        f"UPDATE llm_profiles SET {set_clause} WHERE id = :id",
        {**patch, "id": profile_id},
    )
    if cursor.rowcount == 0:
        return None
    logger.info("LLM 配置项已更新 id=%s", profile_id)
    return await get_llm_profile(profile_id)


async def delete_llm_profile(profile_id: str) -> bool:
    cursor = await get_db().execute("DELETE FROM llm_profiles WHERE id = ?", (profile_id,))
    if cursor.rowcount:
        logger.info("LLM 配置项已删除 id=%s", profile_id)
        return True
    return False


async def set_active_llm_profile(profile_id: str) -> None:
    await get_db().execute(
        """
        INSERT INTO app_config (key, value, updated_at) VALUES (:key, :value, :now)
        ON CONFLICT (key) DO UPDATE SET value = :value, updated_at = :now
        """,
        {"key": _ACTIVE_PROFILE_KEY, "value": profile_id, "now": format_iso(now_china())},
    )
    logger.info("LLM 当前选中配置 id=%s", profile_id)


async def get_active_llm_profile() -> LlmProfile | None:
    _, active_id = await list_llm_profiles()
    if not active_id:
        return None
    return await get_llm_profile(active_id)


async def migrate_legacy_llm_config() -> None:
    items, _ = await list_llm_profiles()
    if items:
        return
    legacy = await get_legacy_llm_config()
    if not legacy:
        return
    created = await create_llm_profile(LlmProfileCreate(
        name="默认",
        base_url=legacy.base_url,
        api_key=legacy.api_key,
        model=legacy.model,
        timeout=legacy.timeout,
        protocol=legacy.protocol,
    ))
    await set_active_llm_profile(created.id)
    logger.info("已迁移旧版 LLM 单配置为配置项 id=%s", created.id)
