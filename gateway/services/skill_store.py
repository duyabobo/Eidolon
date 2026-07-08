import logging

from models.skill import SkillListItem
from services import skill_mongo

logger = logging.getLogger(__name__)


async def list_skills_for_user(user_id: str | None) -> list[SkillListItem]:
    return await skill_mongo.list_skills_for_user(user_id)


async def read_skill_content(name: str, user_id: str | None) -> str:
    from services import skill_fs

    if user_id:
        raw = skill_fs.read_user_skill_raw(user_id, name)
    else:
        raw = skill_fs.read_system_skill_raw(name)
    if raw is None:
        raise LookupError(f"skill '{name}' 文件不存在")
    return raw
