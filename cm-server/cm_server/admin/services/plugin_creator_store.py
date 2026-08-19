"""插件创建器会话存储。"""
import logging
import uuid

from pi_shared import format_iso, now_china
from pi_shared.sqlite import dumps, loads

from cm_server.admin.models.plugin_creator import (
    PluginCreatorMessage,
    PluginCreatorSession,
    PluginDraft,
)
from cm_server.admin.services.db import get_db

logger = logging.getLogger(__name__)


def _row_to_session(row: dict) -> PluginCreatorSession:
    draft_raw = loads(row.get("draft"), None)
    return PluginCreatorSession(
        id=row["id"],
        user_id=row.get("user_id"),
        messages=[PluginCreatorMessage(**m) for m in loads(row.get("messages"), [])],
        draft=PluginDraft(**draft_raw) if draft_raw else None,
        published=bool(row.get("published", 0)),
        plugin_name=row.get("plugin_name"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def create_session(user_id: str | None = None) -> PluginCreatorSession:
    session = PluginCreatorSession(id=str(uuid.uuid4()), user_id=user_id)
    now = format_iso(session.created_at)
    await get_db().execute(
        """
        INSERT INTO plugin_creator_sessions
        (id, user_id, plugin_name, published, messages, draft, created_at, updated_at)
        VALUES (?, ?, NULL, 0, '[]', NULL, ?, ?)
        """,
        (session.id, user_id, now, now),
    )
    logger.info("plugin-creator 会话已创建: %s user_id=%s", session.id, user_id)
    return session


async def get_session(session_id: str) -> PluginCreatorSession | None:
    row = await get_db().fetch_one(
        "SELECT * FROM plugin_creator_sessions WHERE id = ?", (session_id,),
    )
    return _row_to_session(row) if row else None


async def get_latest_unpublished_session(user_id: str | None) -> PluginCreatorSession | None:
    db = get_db()
    if user_id:
        row = await db.fetch_one(
            """
            SELECT * FROM plugin_creator_sessions
            WHERE user_id = ? AND published = 0 ORDER BY updated_at DESC LIMIT 1
            """,
            (user_id,),
        )
    else:
        row = await db.fetch_one(
            """
            SELECT * FROM plugin_creator_sessions
            WHERE user_id IS NULL AND published = 0 ORDER BY updated_at DESC LIMIT 1
            """
        )
    return _row_to_session(row) if row else None


async def get_session_by_plugin_name(user_id: str | None, plugin_name: str) -> PluginCreatorSession | None:
    db = get_db()
    if user_id:
        row = await db.fetch_one(
            """
            SELECT * FROM plugin_creator_sessions
            WHERE user_id = ? AND plugin_name = ? ORDER BY updated_at DESC LIMIT 1
            """,
            (user_id, plugin_name),
        )
    else:
        row = await db.fetch_one(
            """
            SELECT * FROM plugin_creator_sessions
            WHERE user_id IS NULL AND plugin_name = ? ORDER BY updated_at DESC LIMIT 1
            """,
            (plugin_name,),
        )
    return _row_to_session(row) if row else None


async def mark_published(session_id: str, plugin_name: str) -> None:
    await get_db().execute(
        """
        UPDATE plugin_creator_sessions
        SET published = 1, plugin_name = ?, updated_at = ? WHERE id = ?
        """,
        (plugin_name, format_iso(now_china()), session_id),
    )


async def reset_messages(session_id: str) -> None:
    await get_db().execute(
        """
        UPDATE plugin_creator_sessions
        SET messages = '[]', draft = NULL, updated_at = ? WHERE id = ?
        """,
        (format_iso(now_china()), session_id),
    )


async def append_messages(
    session_id: str,
    user_message: PluginCreatorMessage,
    assistant_message: PluginCreatorMessage,
    draft: PluginDraft | None,
) -> None:
    session = await get_session(session_id)
    if session is None:
        return
    messages = [m.model_dump(mode="json") for m in session.messages]
    messages.append(user_message.model_dump(mode="json"))
    messages.append(assistant_message.model_dump(mode="json"))
    now = format_iso(now_china())
    if draft is not None:
        await get_db().execute(
            """
            UPDATE plugin_creator_sessions
            SET messages = ?, draft = ?, updated_at = ? WHERE id = ?
            """,
            (dumps(messages), dumps(draft.model_dump()), now, session_id),
        )
        return
    await get_db().execute(
        "UPDATE plugin_creator_sessions SET messages = ?, updated_at = ? WHERE id = ?",
        (dumps(messages), now, session_id),
    )


async def set_plugin_draft(
    session_id: str,
    plugin_name: str,
    draft: PluginDraft,
) -> None:
    await get_db().execute(
        """
        UPDATE plugin_creator_sessions
        SET plugin_name = ?, draft = ?, updated_at = ? WHERE id = ?
        """,
        (plugin_name, dumps(draft.model_dump()), format_iso(now_china()), session_id),
    )


async def set_initial_message(session_id: str, message: PluginCreatorMessage) -> None:
    now = format_iso(now_china())
    messages = dumps([message.model_dump(mode="json")])
    await get_db().execute(
        "UPDATE plugin_creator_sessions SET messages = ?, updated_at = ? WHERE id = ?",
        (messages, now, session_id),
    )
