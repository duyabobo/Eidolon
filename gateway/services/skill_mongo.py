import logging
from typing import Any

from pi_shared import now_china

from models.skill import SkillListItem, SkillMeta, SkillScope
from services.mongo_client import get_db

logger = logging.getLogger(__name__)

_SKILL_COLLECTION = "skills"


def _system_user_filter() -> dict[str, Any]:
    return {"$or": [{"user_id": None}, {"user_id": {"$exists": False}}]}


def _meta_key(name: str, user_id: str | None) -> dict[str, Any]:
    return {"name": name, "user_id": user_id}


def _to_list_item(raw: dict[str, Any]) -> SkillListItem:
    user_id = raw.get("user_id")
    scope = SkillScope.USER if user_id else SkillScope.SYSTEM
    return SkillListItem(
        name=str(raw["name"]),
        description=str(raw.get("description") or ""),
        scope=scope,
        tags=list(raw.get("tags") or []),
        mcp_servers=[str(item) for item in (raw.get("mcp_servers") or []) if str(item).strip()],
        mcp_tools=[str(item) for item in (raw.get("mcp_tools") or []) if str(item).strip()],
        user_id=str(user_id) if user_id else None,
    )


async def ensure_skill_indexes() -> None:
    await get_db()[_SKILL_COLLECTION].create_index(
        [("user_id", 1), ("name", 1)],
        unique=True,
        name="skill_user_name_unique",
    )


async def list_skills_for_user(user_id: str | None) -> list[SkillListItem]:
    db = get_db()
    system_cursor = db[_SKILL_COLLECTION].find({**_system_user_filter(), "hidden": {"$ne": True}})
    items = [_to_list_item(raw) async for raw in system_cursor]

    if user_id and user_id.strip():
        uid = user_id.strip()
        user_cursor = db[_SKILL_COLLECTION].find({"user_id": uid})
        items.extend([_to_list_item(raw) async for raw in user_cursor])

    items.sort(key=lambda item: (item.scope.value, item.name))
    logger.info(
        "skill 列表 user=%s system=%d user=%d",
        user_id or "-",
        sum(1 for i in items if i.scope == SkillScope.SYSTEM),
        sum(1 for i in items if i.scope == SkillScope.USER),
    )
    return items


async def save_skill_meta(meta: SkillMeta) -> SkillMeta:
    meta.updated_at = now_china()
    # created_at 仅在首次插入时写入（$setOnInsert），更新时不能同时出现在 $set 里，否则 MongoDB 报冲突
    set_data = {k: v for k, v in meta.model_dump().items() if k != "created_at"}
    await get_db()[_SKILL_COLLECTION].update_one(
        _meta_key(meta.name, meta.user_id),
        {"$set": set_data, "$setOnInsert": {"created_at": meta.created_at}},
        upsert=True,
    )
    logger.info("skill 元数据已保存 name=%s user_id=%s", meta.name, meta.user_id)
    return meta


async def delete_skill_meta(name: str, user_id: str | None) -> bool:
    result = await get_db()[_SKILL_COLLECTION].delete_one(_meta_key(name, user_id))
    if result.deleted_count:
        logger.info("skill 元数据已删除 name=%s user_id=%s", name, user_id)
        return True
    return False
