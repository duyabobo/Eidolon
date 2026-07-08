import logging
import uuid
from datetime import datetime

from models.skill_creator import SkillCreatorMessage, SkillCreatorSession, SkillDraft
from services import mongo_client

logger = logging.getLogger(__name__)

_COLLECTION = "skill_creator_sessions"


def _now() -> datetime:
    return datetime.utcnow()


async def create_session() -> SkillCreatorSession:
    session = SkillCreatorSession(id=str(uuid.uuid4()))
    await mongo_client.db[_COLLECTION].insert_one(session.model_dump())
    logger.info("skill-creator 会话已创建: %s", session.id)
    return session


async def get_session(session_id: str) -> SkillCreatorSession | None:
    doc = await mongo_client.db[_COLLECTION].find_one({"id": session_id})
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

    result = await mongo_client.db[_COLLECTION].update_one({"id": session_id}, update)
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
    await mongo_client.db[_COLLECTION].update_one({"id": session_id}, update)
