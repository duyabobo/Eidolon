"""本地 SQLite 访问层：CM 桌面架构下替代原 MongoDB。

单机单用户场景不再需要跨进程共享的数据库服务，所有服务改为读写同一个本地
SQLite 文件（WAL 模式支持多进程并发读 + 单写）。每个服务在自己的 `*_db.py`
里持有一个 `Database` 实例并传入自己的表结构 SQL，本模块只负责连接生命周期
和通用的行转 dict 读写，不感知具体表结构。
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import aiosqlite

logger = logging.getLogger(__name__)

_BUSY_TIMEOUT_MS = 5_000


class Database:
    """单个 SQLite 文件的连接封装。"""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    @property
    def path(self) -> str:
        return self._db_path

    @property
    def connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError(f"SQLite 未连接: {self._db_path}，请先调用 connect()")
        return self._conn

    async def connect(self, schema_sql: str | None = None) -> None:
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        # WAL：允许其它服务进程（合并前）并发只读；busy_timeout 避免写冲突时立即报错
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA foreign_keys=ON")
        await self._conn.execute(f"PRAGMA busy_timeout={_BUSY_TIMEOUT_MS}")
        if schema_sql:
            await self._conn.executescript(schema_sql)
            await self._conn.commit()
        logger.info("SQLite 已连接: %s", self._db_path)

    async def disconnect(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None
            logger.info("SQLite 连接已关闭: %s", self._db_path)

    async def execute(self, sql: str, params: tuple | dict = ()) -> aiosqlite.Cursor:
        cursor = await self.connection.execute(sql, params)
        await self.connection.commit()
        return cursor

    async def executemany(self, sql: str, seq_of_params: list[tuple]) -> None:
        await self.connection.executemany(sql, seq_of_params)
        await self.connection.commit()

    async def fetch_one(self, sql: str, params: tuple | dict = ()) -> dict[str, Any] | None:
        cursor = await self.connection.execute(sql, params)
        row = await cursor.fetchone()
        return dict(row) if row is not None else None

    async def fetch_all(self, sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
        cursor = await self.connection.execute(sql, params)
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


def dumps(value: Any) -> str:
    """JSON 字段序列化：SQLite 无原生数组/对象类型，统一存 TEXT 列。"""
    return json.dumps(value, ensure_ascii=False)


def loads(raw: str | None, default: Any = None) -> Any:
    if not raw:
        return default
    return json.loads(raw)
