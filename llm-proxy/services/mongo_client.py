import logging
import uuid

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ReturnDocument

from config import settings
from models.config import LlmConfig, LlmProfile, LlmProfileCreate, LlmProfileUpdate
from models.llm_record import LlmCallRecord, LlmCallRecordSummary

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None

_CONFIG_COLLECTION = "configs"
_LLM_DOC_ID = "llm"
_LLM_STATE_DOC_ID = "llm_state"
_LLM_PROFILES_COLLECTION = "llm_profiles"
_LLM_RECORDS_COLLECTION = "llm_calls"


def get_db() -> AsyncIOMotorDatabase:
    if _client is None:
        raise RuntimeError("MongoDB 客户端未初始化")
    return _client[settings.mongo_db]


async def connect() -> None:
    global _client
    _client = AsyncIOMotorClient(settings.mongo_uri)
    logger.info("llm-proxy MongoDB 已连接: %s", settings.mongo_uri)


async def disconnect() -> None:
    global _client
    if _client:
        _client.close()
        _client = None


async def get_llm_config() -> LlmConfig | None:
    raw = await get_db()[_CONFIG_COLLECTION].find_one({"_id": _LLM_DOC_ID})
    if not raw:
        return None
    raw.pop("_id", None)
    return LlmConfig(**raw)


async def save_llm_config(cfg: LlmConfig) -> None:
    await get_db()[_CONFIG_COLLECTION].update_one(
        {"_id": _LLM_DOC_ID},
        {"$set": cfg.model_dump()},
        upsert=True,
    )
    logger.info("LLM 配置已保存: model=%s base_url=%s", cfg.model, cfg.base_url)


def _to_llm_profile(raw: dict) -> LlmProfile:
    data = dict(raw)
    data["id"] = str(data.pop("_id"))
    return LlmProfile(**data)


async def list_llm_profiles() -> tuple[list[LlmProfile], str | None]:
    db = get_db()
    cursor = db[_LLM_PROFILES_COLLECTION].find({}).sort("name", 1)
    items: list[LlmProfile] = []
    async for raw in cursor:
        items.append(_to_llm_profile(raw))
    state = await db[_CONFIG_COLLECTION].find_one({"_id": _LLM_STATE_DOC_ID})
    active_id = str(state["active_id"]) if state and state.get("active_id") else None
    return items, active_id


async def get_llm_profile(profile_id: str) -> LlmProfile | None:
    raw = await get_db()[_LLM_PROFILES_COLLECTION].find_one({"_id": profile_id})
    if not raw:
        return None
    return _to_llm_profile(raw)


async def create_llm_profile(body: LlmProfileCreate) -> LlmProfile:
    profile_id = str(uuid.uuid4())
    doc = {"_id": profile_id, **body.model_dump()}
    await get_db()[_LLM_PROFILES_COLLECTION].insert_one(doc)
    logger.info("LLM 配置项已创建 id=%s name=%s", profile_id, body.name)
    return _to_llm_profile(doc)


async def update_llm_profile(profile_id: str, body: LlmProfileUpdate) -> LlmProfile | None:
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        return await get_llm_profile(profile_id)
    result = await get_db()[_LLM_PROFILES_COLLECTION].find_one_and_update(
        {"_id": profile_id},
        {"$set": patch},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        return None
    logger.info("LLM 配置项已更新 id=%s", profile_id)
    return _to_llm_profile(result)


async def delete_llm_profile(profile_id: str) -> bool:
    result = await get_db()[_LLM_PROFILES_COLLECTION].delete_one({"_id": profile_id})
    if result.deleted_count:
        logger.info("LLM 配置项已删除 id=%s", profile_id)
        return True
    return False


async def set_active_llm_profile(profile_id: str) -> None:
    await get_db()[_CONFIG_COLLECTION].update_one(
        {"_id": _LLM_STATE_DOC_ID},
        {"$set": {"active_id": profile_id}},
        upsert=True,
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
    legacy = await get_llm_config()
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


async def insert_llm_record(record: LlmCallRecord) -> None:
    doc = record.model_dump()
    doc["_id"] = record.llm_id
    await get_db()[_LLM_RECORDS_COLLECTION].insert_one(doc)


async def update_llm_record(llm_id: str, fields: dict) -> None:
    await get_db()[_LLM_RECORDS_COLLECTION].update_one({"_id": llm_id}, {"$set": fields})


async def get_llm_record(llm_id: str) -> LlmCallRecord | None:
    raw = await get_db()[_LLM_RECORDS_COLLECTION].find_one({"_id": llm_id})
    if not raw:
        return None
    raw["llm_id"] = str(raw.pop("_id"))
    return LlmCallRecord(**raw)


async def list_llm_records(
    *,
    session_id: str | None = None,
    question_id: str | None = None,
    limit: int = 50,
) -> list[LlmCallRecordSummary]:
    query: dict = {}
    if session_id:
        query["session_id"] = session_id
    if question_id:
        query["question_id"] = question_id

    cursor = (
        get_db()[_LLM_RECORDS_COLLECTION]
        .find(query, projection={"request_body": 0, "messages": 0, "output": 0})
        .sort("created_at", -1)
        .limit(limit)
    )
    results: list[LlmCallRecordSummary] = []
    async for raw in cursor:
        raw["llm_id"] = str(raw.pop("_id"))
        results.append(LlmCallRecordSummary(**raw))
    return results
