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


async def get_latest_unpublished_session(user_id: str | None) -> SkillCreatorSession | None:
    """返回该用户最近的未发布会话（published=False），不存在则返回 None。"""
    if user_id:
        base = {"user_id": user_id}
    else:
        base = {"$or": [{"user_id": None}, {"user_id": {"$exists": False}}]}
    query = {"$and": [base, {"$or": [{"published": False}, {"published": {"$exists": False}}]}]}
    doc = await get_db()[_COLLECTION].find_one(query, sort=[("updated_at", -1)])
    if not doc:
        return None
    doc.pop("_id", None)
    return SkillCreatorSession.model_validate(doc)


async def get_session_by_skill_name(user_id: str | None, skill_name: str) -> SkillCreatorSession | None:
    """按 skill_name 查找已发布会话，用于编辑已保存的 Skill。"""
    if user_id:
        query = {"user_id": user_id, "skill_name": skill_name}
    else:
        query = {"$or": [{"user_id": None}, {"user_id": {"$exists": False}}], "skill_name": skill_name}
    doc = await get_db()[_COLLECTION].find_one(query, sort=[("updated_at", -1)])
    if not doc:
        return None
    doc.pop("_id", None)
    return SkillCreatorSession.model_validate(doc)


async def mark_published(session_id: str, skill_name: str) -> None:
    """发布成功后标记会话状态，记录对应 Skill 名称。"""
    await get_db()[_COLLECTION].update_one(
        {"id": session_id},
        {"$set": {"published": True, "skill_name": skill_name, "updated_at": _now()}},
    )
    logger.info("skill-creator 会话已标记发布: %s → skill=%s", session_id, skill_name)


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
