"""SQLite 轻量列补齐：CREATE TABLE IF NOT EXISTS 不会给旧表加列。"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pi_shared.sqlite.db import Database

logger = logging.getLogger(__name__)

# (table, column, ddl_fragment) — fragment 为完整 ADD COLUMN 子句内容
_KNOWLEDGE_DOC_COLUMNS: tuple[tuple[str, str], ...] = (
    ("wiki_compiled", "INTEGER NOT NULL DEFAULT 0"),
    ("file_format", "TEXT NOT NULL DEFAULT ''"),
    ("track_id", "TEXT NOT NULL DEFAULT ''"),
    ("owner_user_id", "TEXT NOT NULL DEFAULT ''"),
    ("source_file_path", "TEXT NOT NULL DEFAULT ''"),
)

_SKILLS_COLUMNS: tuple[tuple[str, str], ...] = (
    ("source", "TEXT NOT NULL DEFAULT ''"),
)

_MCP_SERVERS_COLUMNS: tuple[tuple[str, str], ...] = (
    ("transport", "TEXT NOT NULL DEFAULT 'http'"),
    ("command", "TEXT NOT NULL DEFAULT ''"),
    ("args", "TEXT NOT NULL DEFAULT '[]'"),
    ("cwd", "TEXT NOT NULL DEFAULT ''"),
    ("tool_schemas", "TEXT NOT NULL DEFAULT '[]'"),
)


async def _ensure_table_columns(
    db: "Database",
    table: str,
    columns: tuple[tuple[str, str], ...],
) -> None:
    existing = {
        row["name"]
        for row in await db.fetch_all(f"PRAGMA table_info({table})")
    }
    for column, ddl in columns:
        if column in existing:
            continue
        await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
        logger.info("已补齐 %s.%s", table, column)


async def ensure_schema_columns(db: "Database") -> None:
    await _ensure_table_columns(db, "knowledge_documents", _KNOWLEDGE_DOC_COLUMNS)
    await _ensure_table_columns(db, "skills", _SKILLS_COLUMNS)
    await _ensure_table_columns(db, "mcp_servers", _MCP_SERVERS_COLUMNS)
