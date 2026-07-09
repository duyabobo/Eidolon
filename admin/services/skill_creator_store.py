import logging
import uuid
from datetime import datetime

from models.skill_creator import SkillCreatorMessage, SkillCreatorSession, SkillDraft
from services.mongo_client import get_db

logger = logging.getLogger(__name__)

_COLLECTION = "skill_creator_sessions"


def _now() -> datetime:
    return datetime.utcnow()


async def create_session(user_id: str | None = None) -> SkillCreatorSession:
    session = SkillCreatorSession(id=str(uuid.uuid4()), user_id=user_id)
    await get_db()[_COLLECTION].insert_one(session.model_dump())
    logger.info("skill-creator 会话已创建: %s user_id=%s", session.id, user_id)
    return session


async def get_session(session_id: str) -> SkillCreatorSession | None:
    doc = await get_db()[_COLLECTION].find_one({"id": session_id})
    if not doc:
        return None
    doc.pop("_id", None)
    return SkillCreatorSession.model_validate(doc)


async def get_latest_session(user_id: str | None) -> SkillCreatorSession | None:
    """返回该用户最近更新的会话，不存在则返回 None。"""
    if user_id:
        query = {"user_id": user_id}
    else:
        query = {"$or": [{"user_id": None}, {"user_id": {"$exists": False}}]}
    doc = await get_db()[_COLLECTION].find_one(query, sort=[("updated_at", -1)])
    if not doc:
        return None
    doc.pop("_id", None)
    return SkillCreatorSession.model_validate(doc)


async def append_messages(
    session_id: str,
    user_message: SkillCreatorMessage,
    assistant_message: SkillCreatorMessage,
    draft: SkillDraft | None,
) -> SkillCreatorSession | None:
    update: dict = {
        "$push": {"messages": {"$each": [user_message.model_dump(), assistant_message.model_dump()]}},
        "$set": {"updated_at": _now()},
    }
    if draft is not None:
        update["$set"]["draft"] = draft.model_dump()

    result = await get_db()[_COLLECTION].update_one({"id": session_id}, update)
    if result.matched_count == 0:
        return None
    return await get_session(session_id)


async def set_initial_message(
    session_id: str,
    message: SkillCreatorMessage,
    draft: SkillDraft | None = None,
) -> None:
    update: dict = {
        "$push": {"messages": message.model_dump()},
        "$set": {"updated_at": _now()},
    }
    if draft is not None:
        update["$set"]["draft"] = draft.model_dump()
    await get_db()[_COLLECTION].update_one({"id": session_id}, update)
