"""聊天 session 只读/追加访问（admin 侧）：CM 架构下替代原 admin/services/mongo_client.py 中 session 相关部分（Mongo → SQLite）。

`sessions` 表由 gateway 写入，admin 仅用于 workspace 目录列表 enrichment 及对话附件回写事件，
与 gateway/services/session_store.py 共享同一张表。
"""
import logging
from typing import Any

from pi_shared.sqlite import dumps, loads

from cm_server.admin.services.db import get_db

logger = logging.getLogger(__name__)


async def list_user_session_meta(user_id: str) -> dict[str, dict[str, Any]]:
    """查询用户会话摘要，供 workspace sessions 列表展示名 enrichment。

    返回 {session_id: {"request": str, "created_at": str|None}}。
    """
    rows = await get_db().fetch_all(
        "SELECT id, request, created_at FROM sessions WHERE user_id = ?", (user_id,)
    )
    return {
        str(row["id"]): {
            "request": str(row.get("request") or ""),
            "created_at": row.get("created_at"),
        }
        for row in rows
    }


async def get_chat_session_owner(session_id: str) -> str | None:
    """返回聊天 session 的 user_id；不存在则 None。"""
    row = await get_db().fetch_one("SELECT user_id FROM sessions WHERE id = ?", (session_id,))
    if row is None:
        return None
    return str(row.get("user_id") or "") or None


async def append_chat_session_event(session_id: str, event: dict[str, Any]) -> None:
    """向聊天 session 的 events_snapshot 追加事件（与 gateway/services/session_store.py 格式一致）。"""
    db = get_db()
    row = await db.fetch_one("SELECT events_snapshot FROM sessions WHERE id = ?", (session_id,))
    if row is None:
        logger.warning("追加 session 事件失败，session 不存在: %s", session_id)
        return
    events = loads(row.get("events_snapshot"), [])
    events.append(event)
    await db.execute(
        "UPDATE sessions SET events_snapshot = ? WHERE id = ?", (dumps(events), session_id)
    )
    logger.info("session 事件已追加: session=%s type=%s", session_id, event.get("event_type"))
