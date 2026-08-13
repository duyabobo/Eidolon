"""Skill 元数据管理（admin 侧）：CM 架构下替代原 admin/services/mongo_client.py 中 skill 相关部分（Mongo → SQLite）。"""
import logging

from pi_shared import format_iso, now_china
from pi_shared.sqlite import dumps, loads

from cm_server.admin.models.config import SkillMeta
from cm_server.admin.services.db import get_db

logger = logging.getLogger(__name__)


def _row_to_meta(row: dict) -> SkillMeta:
    return SkillMeta(
        name=str(row["name"]),
        description=str(row.get("description") or ""),
        user_id=row.get("user_id"),
        tags=loads(row.get("tags"), []),
        mcp_tools=loads(row.get("mcp_tools"), []),
        hidden=bool(row.get("hidden", 0)),
        source=str(row.get("source") or ""),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


async def list_skill_metas() -> list[SkillMeta]:
    """列出所有系统 Skill 元数据（`user_id IS NULL`）。"""
    rows = await get_db().fetch_all("SELECT * FROM skills WHERE user_id IS NULL")
    return [_row_to_meta(row) for row in rows]


async def get_skill_meta(name: str, user_id: str | None = None) -> SkillMeta | None:
    row = await get_db().fetch_one(
        "SELECT * FROM skills WHERE name = ? AND user_id IS ?",
        (name, user_id),
    )
    return _row_to_meta(row) if row else None


async def save_skill_meta(meta: SkillMeta) -> SkillMeta:
    """新增/更新 skill 元数据（系统或用户级，取决于 `meta.user_id`）。

    注：`skills` 主键是 (name, user_id)，SQLite 把 NULL 列视为互不相等，
    系统级记录 `user_id IS NULL` 不会触发 `ON CONFLICT`，必须显式 SELECT 后分支写。
    """
    db = get_db()
    now = format_iso(now_china())
    existing = await db.fetch_one(
        "SELECT created_at FROM skills WHERE name = ? AND user_id IS ?",
        (meta.name, meta.user_id),
    )
    meta.updated_at = now_china()
    created_at = existing["created_at"] if existing else format_iso(meta.created_at)

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
        "DELETE FROM skills WHERE name = ? AND user_id IS ?", (name, user_id)
    )
    deleted = cursor.rowcount > 0
    if deleted:
        logger.info("skill 元数据已删除 name=%s user_id=%s", name, user_id or "system")
    return deleted
