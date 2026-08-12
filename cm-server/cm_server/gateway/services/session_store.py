"""Session 存储：CM 架构下替代原 gateway/services/mongo_client.py 中的 session 相关函数。"""
import logging
from typing import Any

from pi_shared import format_iso, now_china
from pi_shared.sqlite import dumps, loads

from cm_server.gateway.models.session import SessionDocument, SessionStatus, SessionSummary
from cm_server.gateway.services.db import get_db

logger = logging.getLogger(__name__)


def _row_to_document(row: dict[str, Any]) -> SessionDocument:
    return SessionDocument(
        _id=row["id"],
        user_id=row["user_id"],
        conversation_id=row.get("conversation_id"),
        status=SessionStatus(row["status"]),
        request=row["request"],
        skill_ids=loads(row.get("skill_ids"), []),
        events_snapshot=loads(row.get("events_snapshot"), []),
        error=row.get("error"),
        created_at=row["created_at"],
        started_at=row.get("started_at"),
        completed_at=row.get("completed_at"),
    )


async def create_session(
    session_id: str,
    user_id: str,
    request: str,
    skill_ids: list[str] | None = None,
    conversation_id: str | None = None,
    status: SessionStatus = SessionStatus.PENDING,
    skip_initial_user_message: bool = False,
) -> SessionDocument:
    # 第一条用户消息立即写入 events_snapshot，与后续轮次保持一致的存储格式
    events: list[dict[str, Any]] = []
    if not skip_initial_user_message:
        events.append({"event_type": "user_message", "content": request, "ts": int(now_china().timestamp() * 1000)})

    created_at = now_china()
    await get_db().execute(
        """
        INSERT INTO sessions (id, user_id, conversation_id, status, request, skill_ids, events_snapshot, created_at)
        VALUES (:id, :user_id, :conversation_id, :status, :request, :skill_ids, :events_snapshot, :created_at)
        """,
        {
            "id": session_id,
            "user_id": user_id,
            "conversation_id": conversation_id,
            "status": status.value,
            "request": request,
            "skill_ids": dumps(skill_ids or []),
            "events_snapshot": dumps(events),
            "created_at": format_iso(created_at),
        },
    )
    logger.info(
        "session 创建成功: %s user=%s conversation=%s skills=%s status=%s",
        session_id, user_id, conversation_id, skill_ids, status,
    )
    return SessionDocument(
        _id=session_id,
        user_id=user_id,
        conversation_id=conversation_id,
        status=status,
        request=request,
        skill_ids=skill_ids or [],
        events_snapshot=events,
        created_at=created_at,
    )


async def get_session(session_id: str) -> SessionDocument | None:
    row = await get_db().fetch_one("SELECT * FROM sessions WHERE id = ?", (session_id,))
    if row is None:
        return None
    return _row_to_document(row)


async def find_active_session_by_request(user_id: str, request: str) -> SessionDocument | None:
    """
    幂等性查找：同一 user 发起相同 request 时，若已有进行中的 session 则复用。
    支持并发不同 request 的多个 session（session 级文件系统隔离，互不影响）。
    """
    row = await get_db().fetch_one(
        """
        SELECT * FROM sessions
        WHERE user_id = ? AND request = ? AND status IN (?, ?)
        LIMIT 1
        """,
        (user_id, request, SessionStatus.PENDING.value, SessionStatus.RUNNING.value),
    )
    if row is None:
        return None
    return _row_to_document(row)


async def get_recent_sessions(user_id: str, limit: int = 20) -> list[SessionSummary]:
    """查询用户近期 session（按创建时间降序），只返回摘要字段，不含 events_snapshot"""
    rows = await get_db().fetch_all(
        """
        SELECT id, status, request, created_at, completed_at, conversation_id
        FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
        """,
        (user_id, limit),
    )
    return [
        SessionSummary(
            session_id=row["id"],
            status=SessionStatus(row["status"]),
            request=row["request"],
            created_at=row["created_at"],
            completed_at=row.get("completed_at"),
        )
        for row in rows
    ]


async def get_sessions_by_conversation(conversation_id: str) -> list[SessionSummary]:
    """按对话 ID 查询所有 session（按创建时间升序，重建消息历史顺序）"""
    rows = await get_db().fetch_all(
        """
        SELECT id, status, request, created_at, completed_at, conversation_id
        FROM sessions WHERE conversation_id = ? ORDER BY created_at ASC
        """,
        (conversation_id,),
    )
    return [
        SessionSummary(
            session_id=row["id"],
            status=SessionStatus(row["status"]),
            request=row["request"],
            created_at=row["created_at"],
            completed_at=row.get("completed_at"),
        )
        for row in rows
    ]


async def get_recent_conversations(user_id: str, limit: int = 20) -> list[dict]:
    """
    按 conversation_id 聚合，返回用户最近的对话列表（一条对话一个条目）。
    用于侧边栏历史列表，避免同一对话在列表里重复出现多条。
    """
    rows = await get_db().fetch_all(
        """
        SELECT
            conversation_id,
            (SELECT request FROM sessions s2
             WHERE s2.conversation_id = s1.conversation_id AND s2.user_id = :user_id
             ORDER BY created_at ASC LIMIT 1) AS first_request,
            (SELECT status FROM sessions s3
             WHERE s3.conversation_id = s1.conversation_id AND s3.user_id = :user_id
             ORDER BY created_at DESC LIMIT 1) AS last_status,
            MAX(created_at) AS last_created_at,
            COUNT(*) AS session_count
        FROM sessions s1
        WHERE user_id = :user_id AND conversation_id IS NOT NULL
        GROUP BY conversation_id
        ORDER BY last_created_at DESC
        LIMIT :limit
        """,
        {"user_id": user_id, "limit": limit},
    )
    return [
        {
            "conversation_id": row["conversation_id"],
            "first_request": row["first_request"],
            "last_status": row["last_status"],
            "last_created_at": row["last_created_at"],
            "session_count": row["session_count"],
        }
        for row in rows
    ]


async def get_conversation_sessions_with_events(conversation_id: str) -> list[dict]:
    """
    获取对话内所有 session（含 events_snapshot），按时间升序排列。
    供前端一次性重建完整消息列表，消除 N+1 请求问题。
    """
    rows = await get_db().fetch_all(
        """
        SELECT id, status, request, events_snapshot FROM sessions
        WHERE conversation_id = ? ORDER BY created_at ASC
        """,
        (conversation_id,),
    )
    return [
        {
            "session_id": row["id"],
            "status": row.get("status", "UNKNOWN"),
            "request": row.get("request", ""),
            "events_snapshot": loads(row.get("events_snapshot"), []),
        }
        for row in rows
    ]


async def append_event_snapshot(session_id: str, event: dict[str, Any]) -> None:
    """将 pi-runtime 推送的事件追加到 events_snapshot，供断线重连回放"""
    row = await get_db().fetch_one("SELECT events_snapshot FROM sessions WHERE id = ?", (session_id,))
    if row is None:
        logger.warning("追加事件失败，session 不存在: %s", session_id)
        return
    events = loads(row.get("events_snapshot"), [])
    events.append(event)
    await get_db().execute(
        "UPDATE sessions SET events_snapshot = ? WHERE id = ?",
        (dumps(events), session_id),
    )


async def append_event_snapshot_batch(session_id: str, events: list[dict[str, Any]]) -> None:
    """批量追加事件到 events_snapshot（一次 SELECT + 一次 UPDATE），供 pi-runtime 定时 flush 调用。"""
    if not events:
        return
    row = await get_db().fetch_one("SELECT events_snapshot FROM sessions WHERE id = ?", (session_id,))
    if row is None:
        logger.warning("批量追加事件失败，session 不存在: %s", session_id)
        return
    existing = loads(row.get("events_snapshot"), [])
    existing.extend(events)
    await get_db().execute(
        "UPDATE sessions SET events_snapshot = ? WHERE id = ?",
        (dumps(existing), session_id),
    )
    logger.info("session 事件批量追加: session=%s count=%d", session_id, len(events))


async def update_session_status(
    session_id: str,
    status: SessionStatus,
    extra_fields: dict[str, Any] | None = None,
) -> None:
    fields: dict[str, Any] = {"status": status.value}
    if status == SessionStatus.RUNNING:
        fields["started_at"] = format_iso(now_china())
    elif status in (SessionStatus.COMPLETED, SessionStatus.FAILED):
        # IDLE 不写 completed_at，保留其可重启语义
        fields["completed_at"] = format_iso(now_china())
    if extra_fields:
        fields.update(extra_fields)

    set_clause = ", ".join(f"{key} = :{key}" for key in fields)
    await get_db().execute(
        f"UPDATE sessions SET {set_clause} WHERE id = :id",
        {**fields, "id": session_id},
    )
    logger.info("session 状态更新: %s -> %s", session_id, status)
