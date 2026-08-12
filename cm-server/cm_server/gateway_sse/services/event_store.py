"""轮次增量事件存取：CM 架构下替代原 gateway-sse/services/redis_client.py（Redis Stream → SQLite 事件表 + 进程内 asyncio 事件通知）。

pi-runtime 产生一个 token/tool_call/... 事件即调用 `publish_event` 写一行到本地 SQLite
`turn_events` 表（`seq` 自增，充当原 Redis Stream 消息 ID），随后 `notify_all` 唤醒同一
turn 上挂起的 SSE 生成器；生成器统一以 SQLite 为准回放，`asyncio.Condition` 只起“有新
事件了，去查库”的通知作用，不直接传递事件内容，避免推送丢失。
"""
import asyncio
import logging
from collections import defaultdict
from typing import Any, AsyncGenerator

from pi_shared import format_iso, now_china

from cm_server.gateway_sse.config import settings
from cm_server.gateway_sse.services.db import get_db

logger = logging.getLogger(__name__)

_TERMINAL_EVENT_TYPES = ("done", "cancelled")

_turn_conditions: dict[tuple[str, str], asyncio.Condition] = defaultdict(asyncio.Condition)


def _turn_key(session_id: str, turn_id: str) -> tuple[str, str]:
    return (session_id, turn_id)


async def publish_event(session_id: str, turn_id: str, event_type: str, content: str) -> int:
    """写入一条轮次增量事件，返回新事件的 seq（替代原 Redis XADD）。"""
    cursor = await get_db().execute(
        "INSERT INTO turn_events (session_id, turn_id, event_type, content, created_at) VALUES (?, ?, ?, ?, ?)",
        (session_id, turn_id, event_type, content, format_iso(now_china())),
    )
    seq = cursor.lastrowid

    condition = _turn_conditions[_turn_key(session_id, turn_id)]
    async with condition:
        condition.notify_all()
    return seq


async def _fetch_events_after(session_id: str, turn_id: str, after_seq: int) -> list[dict[str, Any]]:
    rows = await get_db().fetch_all(
        """
        SELECT seq, event_type, content FROM turn_events
        WHERE session_id = ? AND turn_id = ? AND seq > ?
        ORDER BY seq
        """,
        (session_id, turn_id, after_seq),
    )
    return [{"id": str(row["seq"]), "event_type": row["event_type"], "content": row["content"]} for row in rows]


async def stream_turn_events(
    session_id: str,
    turn_id: str,
    after_seq: int = 0,
) -> AsyncGenerator[dict[str, Any], None]:
    """
    持续产出指定轮次的增量事件（替代原 redis_client.stream_turn_output）。

    先回放 SQLite 中 seq > after_seq 的历史事件（断线重传），再挂起等待新事件；
    每隔 settings.sse_heartbeat_interval_s 无新事件则 yield 心跳，遇到 done/cancelled 终止事件结束。
    """
    last_seq = after_seq
    turn_key = _turn_key(session_id, turn_id)

    try:
        while True:
            events = await _fetch_events_after(session_id, turn_id, last_seq)
            for event in events:
                last_seq = int(event["id"])
                yield event
                if event["event_type"] in _TERMINAL_EVENT_TYPES:
                    return

            condition = _turn_conditions[turn_key]
            async with condition:
                try:
                    await asyncio.wait_for(condition.wait(), timeout=settings.sse_heartbeat_interval_s)
                except asyncio.TimeoutError:
                    yield {"heartbeat": True}
    finally:
        # 轮次已结束（done/cancelled）或客户端断开：清理内存态 Condition，
        # 避免长时间运行的桌面进程在成千上万个已完成 turn 上无限堆积对象。
        # SQLite 中的历史事件不受影响，后续若仍有连接以相同 turn 重连，会重新按需创建。
        _turn_conditions.pop(turn_key, None)
