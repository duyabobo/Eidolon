"""Skill Creator 对话草稿会话存储：CM 架构下替代原 Mongo 实现（Mongo → SQLite）。"""
import logging
import uuid

from pi_shared import format_iso, now_china
from pi_shared.sqlite import dumps, loads

from cm_server.admin.models.skill_creator import SkillCreatorMessage, SkillCreatorSession, SkillDraft
from cm_server.admin.services.db import get_db

logger = logging.getLogger(__name__)


def _row_to_session(row: dict) -> SkillCreatorSession:
    draft_raw = loads(row.get("draft"), None)
    return SkillCreatorSession(
        id=row["id"],
        user_id=row.get("user_id"),
        messages=[SkillCreatorMessage(**m) for m in loads(row.get("messages"), [])],
        draft=SkillDraft(**draft_raw) if draft_raw else None,
        published=bool(row.get("published", 0)),
        skill_name=row.get("skill_name"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def create_session(user_id: str | None = None) -> SkillCreatorSession:
    session = SkillCreatorSession(id=str(uuid.uuid4()), user_id=user_id)
    now = format_iso(session.created_at)
    await get_db().execute(
        """
        INSERT INTO skill_creator_sessions (id, user_id, skill_name, published, messages, draft, created_at, updated_at)
        VALUES (?, ?, NULL, 0, '[]', NULL, ?, ?)
        """,
        (session.id, user_id, now, now),
    )
    logger.info("skill-creator 会话已创建: %s user_id=%s", session.id, user_id)
    return session


async def get_session(session_id: str) -> SkillCreatorSession | None:
    row = await get_db().fetch_one("SELECT * FROM skill_creator_sessions WHERE id = ?", (session_id,))
    return _row_to_session(row) if row else None


async def get_latest_unpublished_session(user_id: str | None) -> SkillCreatorSession | None:
    """返回该用户最近的未发布会话（published=0），不存在则返回 None。"""
    db = get_db()
    if user_id:
        row = await db.fetch_one(
            "SELECT * FROM skill_creator_sessions WHERE user_id = ? AND published = 0 ORDER BY updated_at DESC LIMIT 1",
            (user_id,),
        )
    else:
        row = await db.fetch_one(
            "SELECT * FROM skill_creator_sessions WHERE user_id IS NULL AND published = 0 ORDER BY updated_at DESC LIMIT 1"
        )
    return _row_to_session(row) if row else None


async def get_session_by_skill_name(user_id: str | None, skill_name: str) -> SkillCreatorSession | None:
    """按 skill_name 查找已发布会话，用于编辑已保存的 Skill。"""
    db = get_db()
    if user_id:
        row = await db.fetch_one(
            "SELECT * FROM skill_creator_sessions WHERE user_id = ? AND skill_name = ? ORDER BY updated_at DESC LIMIT 1",
            (user_id, skill_name),
        )
    else:
        row = await db.fetch_one(
            "SELECT * FROM skill_creator_sessions WHERE user_id IS NULL AND skill_name = ? ORDER BY updated_at DESC LIMIT 1",
            (skill_name,),
        )
    return _row_to_session(row) if row else None


async def mark_published(session_id: str, skill_name: str) -> None:
    """发布成功后标记会话状态，记录对应 Skill 名称。"""
    await get_db().execute(
        "UPDATE skill_creator_sessions SET published = 1, skill_name = ?, updated_at = ? WHERE id = ?",
        (skill_name, format_iso(now_china()), session_id),
    )
    logger.info("skill-creator 会话已标记发布: %s → skill=%s", session_id, skill_name)


async def reset_messages(session_id: str) -> None:
    """清空会话历史消息和草稿，用于「重新开始」。"""
    await get_db().execute(
        "UPDATE skill_creator_sessions SET messages = '[]', draft = NULL, updated_at = ? WHERE id = ?",
        (format_iso(now_china()), session_id),
    )
    logger.info("skill-creator 会话已重置: %s", session_id)


async def append_messages(
    session_id: str,
    user_message: SkillCreatorMessage,
    assistant_message: SkillCreatorMessage,
    draft: SkillDraft | None,
) -> SkillCreatorSession | None:
    session = await get_session(session_id)
    if session is None:
        return None
    messages = [m.model_dump(mode="json") for m in session.messages]
    messages.append(user_message.model_dump(mode="json"))
    messages.append(assistant_message.model_dump(mode="json"))

    db = get_db()
    now = format_iso(now_china())
    if draft is not None:
        await db.execute(
            "UPDATE skill_creator_sessions SET messages = ?, draft = ?, updated_at = ? WHERE id = ?",
            (dumps(messages), dumps(draft.model_dump()), now, session_id),
        )
    else:
        await db.execute(
            "UPDATE skill_creator_sessions SET messages = ?, updated_at = ? WHERE id = ?",
            (dumps(messages), now, session_id),
        )
    return await get_session(session_id)


async def set_initial_message(
    session_id: str,
    message: SkillCreatorMessage,
    draft: SkillDraft | None = None,
) -> None:
    session = await get_session(session_id)
    if session is None:
        logger.warning("设置初始消息失败，会话不存在: %s", session_id)
        return
    messages = [m.model_dump(mode="json") for m in session.messages]
    messages.append(message.model_dump(mode="json"))

    db = get_db()
    now = format_iso(now_china())
    if draft is not None:
        await db.execute(
            "UPDATE skill_creator_sessions SET messages = ?, draft = ?, updated_at = ? WHERE id = ?",
            (dumps(messages), dumps(draft.model_dump()), now, session_id),
        )
    else:
        await db.execute(
            "UPDATE skill_creator_sessions SET messages = ?, updated_at = ? WHERE id = ?",
            (dumps(messages), now, session_id),
        )
