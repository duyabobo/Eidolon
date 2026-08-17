"""Skill 元数据读取：CM 架构下替代原 gateway/services/skill_mongo.py（Mongo → SQLite）。

注：gateway 侧只读 Skill 列表（list_skills_for_user），写入/删除由 admin 侧的
skill_meta_store 负责，故此处不再保留 save/delete 副本。
"""
import logging

from pi_shared.sqlite import loads

from cm_server.gateway.models.skill import SkillListItem, SkillScope
from cm_server.gateway.services.db import get_db

logger = logging.getLogger(__name__)


def _to_list_item(row: dict) -> SkillListItem:
    user_id = row.get("user_id")
    scope = SkillScope.USER if user_id else SkillScope.SYSTEM
    return SkillListItem(
        name=str(row["name"]),
        description=str(row.get("description") or ""),
        scope=scope,
        tags=loads(row.get("tags"), []),
        mcp_tools=[str(item) for item in loads(row.get("mcp_tools"), []) if str(item).strip()],
        user_id=str(user_id) if user_id else None,
        source=str(row.get("source") or ""),
    )


async def list_skills_for_user(user_id: str | None) -> list[SkillListItem]:
    db = get_db()
    system_rows = await db.fetch_all(
        "SELECT * FROM skills WHERE user_id IS NULL AND hidden = 0"
    )
    items = [_to_list_item(row) for row in system_rows]

    uid = (user_id or "").strip()
    if uid:
        user_rows = await db.fetch_all("SELECT * FROM skills WHERE user_id = ?", (uid,))
        items.extend(_to_list_item(row) for row in user_rows)

    items.sort(key=lambda item: (item.scope.value, item.name))
    logger.info(
        "skill 列表 user=%s system=%d user=%d",
        user_id or "-",
        sum(1 for i in items if i.scope == SkillScope.SYSTEM),
        sum(1 for i in items if i.scope == SkillScope.USER),
    )
    return items
