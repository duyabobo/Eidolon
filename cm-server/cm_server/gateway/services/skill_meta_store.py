"""Skill 元数据读写：CM 架构下替代原 gateway/services/skill_mongo.py（Mongo → SQLite）。"""
import logging

from pi_shared import format_iso, now_china
from pi_shared.sqlite import dumps, loads

from cm_server.gateway.models.skill import SkillListItem, SkillMeta, SkillScope
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


async def save_skill_meta(meta: SkillMeta) -> SkillMeta:
    """新增/更新 skill 元数据。

    注：`skills` 主键是 (name, user_id)，但 SQLite 把 NULL 列视为互不相等，
    系统级记录 `user_id IS NULL` 不会触发 `ON CONFLICT`，必须显式 SELECT 后分支写，
    否则每次保存都会插入一条新的重复行（见 pi-runtime 迁移排查记录）。
    """
    db = get_db()
    now = format_iso(now_china())
    existing = await db.fetch_one(
        "SELECT created_at FROM skills WHERE name = ? AND user_id IS ?",
        (meta.name, meta.user_id),
    )
    created_at = existing["created_at"] if existing else (format_iso(meta.created_at) if meta.created_at else now)

    if existing:
        await db.execute(
            """
            UPDATE skills SET description = ?, tags = ?, mcp_tools = ?, hidden = ?, source = ?, updated_at = ?
            WHERE name = ? AND user_id IS ?
            """,
            (
                meta.description,
                dumps(meta.tags),
                dumps(meta.mcp_tools),
                int(meta.hidden),
                meta.source or "",
                now,
                meta.name,
                meta.user_id,
            ),
        )
    else:
        await db.execute(
            """
            INSERT INTO skills (name, user_id, description, tags, mcp_tools, hidden, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                meta.name,
                meta.user_id,
                meta.description,
                dumps(meta.tags),
                dumps(meta.mcp_tools),
                int(meta.hidden),
                meta.source or "",
                created_at,
                now,
            ),
        )
    logger.info("skill 元数据已保存 name=%s user_id=%s", meta.name, meta.user_id)
    return meta


async def delete_skill_meta(name: str, user_id: str | None = None) -> bool:
    cursor = await get_db().execute(
        "DELETE FROM skills WHERE name = ? AND user_id IS ?",
        (name, user_id),
    )
    deleted = cursor.rowcount > 0
    if deleted:
        logger.info("skill 元数据已删除 name=%s user_id=%s", name, user_id)
    return deleted
