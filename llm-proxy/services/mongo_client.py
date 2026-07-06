import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from config import settings
from models.config import LlmConfig
from models.llm_record import LlmCallRecord, LlmCallRecordSummary

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None

_CONFIG_COLLECTION = "configs"
_LLM_DOC_ID = "llm"
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
