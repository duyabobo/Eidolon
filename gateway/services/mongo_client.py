import logging
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pi_shared import now_china, now_china_ms

from config import settings
from models.session import SessionDocument, SessionStatus, SessionSummary

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None


def get_db() -> AsyncIOMotorDatabase:
    if _client is None:
        raise RuntimeError("MongoDB 客户端未初始化，请先调用 connect()")
    return _client[settings.mongo_db]


async def connect() -> None:
    global _client
    _client = AsyncIOMotorClient(settings.mongo_uri)
    from services import mcp_mongo, skill_mongo

    await mcp_mongo.ensure_mcp_indexes()
    await skill_mongo.ensure_skill_indexes()
    await _migrate_utc_naive_to_china_wallclock()
    logger.info("MongoDB 连接成功: %s / %s", settings.mongo_uri, settings.mongo_db)


_CHINA_OFFSET_MS = 8 * 60 * 60 * 1000
_MIGRATION_ID = "china_wallclock_v1"


async def _migrate_utc_naive_to_china_wallclock() -> None:
    """历史数据按 UTC naive 写入；一次性 +8h 转为东八区墙钟，避免列表时间少 8 小时。"""
    db = get_db()
    if await db.system_migrations.find_one({"_id": _MIGRATION_ID}):
        return

    shift = [
        {
            "$set": {
                field: {
                    "$cond": [
                        {"$eq": [{"$type": f"${field}"}, "date"]},
                        {"$add": [f"${field}", _CHINA_OFFSET_MS]},
                        f"${field}",
                    ]
                }
            }
        }
        for field in ("created_at", "started_at", "completed_at", "updated_at")
    ]

        for collection in (
            "sessions",
            "skills",
            "mcp_servers",
            "skill_creator_sessions",
            "llm_call_records",
            "knowledge_bases",
            "knowledge_documents",
            "knowledge_service_configs",
        ):
        if collection not in await db.list_collection_names():
            continue
        result = await db[collection].update_many({}, shift)
        logger.info(
            "东八区时间迁移 collection=%s matched=%d modified=%d",
            collection, result.matched_count, result.modified_count,
        )

    await db.system_migrations.insert_one({"_id": _MIGRATION_ID, "applied_at": now_china()})
    logger.info("东八区时间迁移完成 migration=%s", _MIGRATION_ID)


async def disconnect() -> None:
    global _client
    if _client:
        _client.close()
        _client = None
        logger.info("MongoDB 连接已关闭")


async def create_session(
    session_id: str,
    user_id: str,
    request: str,
    skill_ids: list[str] | None = None,
    conversation_id: str | None = None,
) -> SessionDocument:
    # 第一条用户消息立即写入 events_snapshot，与后续轮次保持一致的存储格式
    doc = SessionDocument(
        _id=session_id,
        user_id=user_id,
        conversation_id=conversation_id,
        request=request,
        skill_ids=skill_ids or [],
        events_snapshot=[{"event_type": "user_message", "content": request, "ts": now_china_ms()}],
    )
    db = get_db()
    await db.sessions.insert_one(doc.model_dump(by_alias=True))
    logger.info("session 创建成功: %s user=%s conversation=%s skills=%s", session_id, user_id, conversation_id, skill_ids)
    return doc


async def get_session(session_id: str) -> SessionDocument | None:
    db = get_db()
    raw = await db.sessions.find_one({"_id": session_id})
    if raw is None:
        return None
    return SessionDocument(**raw)


async def find_active_session_by_request(user_id: str, request: str) -> SessionDocument | None:
    """
    幂等性查找：同一 user 发起相同 request 时，若已有进行中的 session 则复用。
    支持并发不同 request 的多个 session（session 级文件系统隔离，互不影响）。
    """
    db = get_db()
    raw = await db.sessions.find_one(
        {
            "user_id": user_id,
            "request": request,
            "status": {"$in": [SessionStatus.PENDING, SessionStatus.RUNNING]},
        }
    )
    if raw is None:
        return None
    return SessionDocument(**raw)


async def get_recent_sessions(user_id: str, limit: int = 20) -> list[SessionSummary]:
    """查询用户近期 session（按创建时间降序），只返回摘要字段，不含 events_snapshot"""
    db = get_db()
    cursor = db.sessions.find(
        {"user_id": user_id},
        {"_id": 1, "status": 1, "request": 1, "created_at": 1, "completed_at": 1, "conversation_id": 1},
    ).sort("created_at", -1).limit(limit)
    return [
        SessionSummary(session_id=str(raw["_id"]), **{k: v for k, v in raw.items() if k != "_id"})
        async for raw in cursor
    ]


async def get_sessions_by_conversation(conversation_id: str) -> list[SessionSummary]:
    """按对话 ID 查询所有 session（按创建时间升序，重建消息历史顺序）"""
    db = get_db()
    cursor = db.sessions.find(
        {"conversation_id": conversation_id},
        {"_id": 1, "status": 1, "request": 1, "created_at": 1, "completed_at": 1, "conversation_id": 1},
    ).sort("created_at", 1)
    return [
        SessionSummary(session_id=str(raw["_id"]), **{k: v for k, v in raw.items() if k != "_id"})
        async for raw in cursor
    ]


async def get_recent_conversations(user_id: str, limit: int = 20) -> list[dict]:
    """
    按 conversation_id 聚合，返回用户最近的对话列表（一条对话一个条目）。
    用于侧边栏历史列表，避免同一对话在列表里重复出现多条。
    """
    db = get_db()
    pipeline = [
        {"$match": {"user_id": user_id, "conversation_id": {"$ne": None}}},
        {"$sort": {"created_at": 1}},
        {"$group": {
            "_id": "$conversation_id",
            "first_request": {"$first": "$request"},
            "last_status": {"$last": "$status"},
            "last_created_at": {"$last": "$created_at"},
            "session_count": {"$sum": 1},
        }},
        {"$sort": {"last_created_at": -1}},
        {"$limit": limit},
    ]
    docs = await db.sessions.aggregate(pipeline).to_list(None)
    return [
        {
            "conversation_id": doc["_id"],
            "first_request": doc["first_request"],
            "last_status": doc["last_status"],
            "last_created_at": doc["last_created_at"],
            "session_count": doc["session_count"],
        }
        for doc in docs
    ]


async def get_conversation_sessions_with_events(conversation_id: str) -> list[dict]:
    """
    获取对话内所有 session（含 events_snapshot），按时间升序排列。
    供前端一次性重建完整消息列表，消除 N+1 请求问题。
    """
    db = get_db()
    cursor = db.sessions.find(
        {"conversation_id": conversation_id},
        {"_id": 1, "status": 1, "request": 1, "events_snapshot": 1},
    ).sort("created_at", 1)
    return [
        {
            "session_id": str(raw["_id"]),
            "status": raw.get("status", "UNKNOWN"),
            "request": raw.get("request", ""),
            "events_snapshot": raw.get("events_snapshot", []),
        }
        async for raw in cursor
    ]


async def append_event_snapshot(session_id: str, event: dict[str, Any]) -> None:
    """将 pi-runtime 推送的事件追加到 MongoDB 快照，供断线重连回放"""
    db = get_db()
    await db.sessions.update_one(
        {"_id": session_id},
        {"$push": {"events_snapshot": event}},
    )


async def update_session_status(
    session_id: str,
    status: SessionStatus,
    extra_fields: dict[str, Any] | None = None,
) -> None:
    update: dict[str, Any] = {"status": status}
    if status == SessionStatus.RUNNING:
        update["started_at"] = now_china()
    elif status in (SessionStatus.COMPLETED, SessionStatus.FAILED):
        # IDLE 不写 completed_at，保留其可重启语义
        update["completed_at"] = now_china()
    if extra_fields:
        update.update(extra_fields)

    db = get_db()
    await db.sessions.update_one({"_id": session_id}, {"$set": update})
    logger.info("session 状态更新: %s -> %s", session_id, status)


