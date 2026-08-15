"""LLM Provider 配置项存储：CM 架构下替代原 llm-proxy/services/mongo_client.py 中的 LLM 配置部分。"""
import logging
import uuid

from pi_shared import format_iso, now_china

from cm_server.llm_proxy.models.config import LlmConfig, LlmProfile, LlmProfileCreate, LlmProfileUpdate
from cm_server.llm_proxy.services.db import get_db

logger = logging.getLogger(__name__)

_LEGACY_CONFIG_KEY = "llm"
_ACTIVE_PROFILE_KEY = "llm_active_profile_id"
_INTENT_PROFILE_KEY = "llm_intent_profile_id"


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


async def _read_profile_id(key: str) -> str | None:
    state = await get_db().fetch_one("SELECT value FROM app_config WHERE key = ?", (key,))
    value = str(state["value"]).strip() if state and state.get("value") else ""
    return value or None


async def _write_profile_id(key: str, profile_id: str | None) -> None:
    if profile_id:
        await get_db().execute(
            """
            INSERT INTO app_config (key, value, updated_at) VALUES (:key, :value, :now)
            ON CONFLICT (key) DO UPDATE SET value = :value, updated_at = :now
            """,
            {"key": key, "value": profile_id, "now": format_iso(now_china())},
        )
        return
    await get_db().execute("DELETE FROM app_config WHERE key = ?", (key,))


async def list_llm_profiles() -> tuple[list[LlmProfile], str | None, str | None]:
    rows = await get_db().fetch_all("SELECT * FROM llm_profiles ORDER BY name ASC")
    items = [_to_profile(row) for row in rows]
    known = {item.id for item in items}
    active_id = await _read_profile_id(_ACTIVE_PROFILE_KEY)
    intent_id = await _read_profile_id(_INTENT_PROFILE_KEY)
    if active_id and active_id not in known:
        active_id = None
    if intent_id and intent_id not in known:
        intent_id = None
        await _write_profile_id(_INTENT_PROFILE_KEY, None)
    return items, active_id, intent_id


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
    await _write_profile_id(_ACTIVE_PROFILE_KEY, profile_id)
    logger.info("LLM 当前选中配置 id=%s", profile_id)


async def set_intent_llm_profile(profile_id: str | None) -> None:
    profile_id = (profile_id or "").strip() or None
    if profile_id:
        profile = await get_llm_profile(profile_id)
        if profile is None:
            raise ValueError("LLM 配置不存在")
    await _write_profile_id(_INTENT_PROFILE_KEY, profile_id)
    logger.info("意图识别模型 id=%s", profile_id or "-")


async def get_active_llm_profile() -> LlmProfile | None:
    _, active_id, _intent_id = await list_llm_profiles()
    if not active_id:
        return None
    return await get_llm_profile(active_id)


async def get_intent_llm_profile() -> LlmProfile | None:
    _items, _active_id, intent_id = await list_llm_profiles()
    if not intent_id:
        return None
    return await get_llm_profile(intent_id)


async def migrate_legacy_llm_config() -> None:
    items, _active_id, _intent_id = await list_llm_profiles()
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
