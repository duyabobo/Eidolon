import logging
from collections.abc import AsyncGenerator
from typing import Any

import redis.asyncio as aioredis

from config import settings

logger = logging.getLogger(__name__)

_pool: aioredis.ConnectionPool | None = None

# Redis Stream key 模板（与 gateway 写入时使用的模板保持一致）
STREAM_KEY = "session:{session_id}:stream"


def _get_stream_key(session_id: str) -> str:
    return STREAM_KEY.format(session_id=session_id)


def get_redis() -> aioredis.Redis:
    if _pool is None:
        raise RuntimeError("Redis 连接池未初始化，请先调用 connect()")
    return aioredis.Redis(connection_pool=_pool)


async def connect() -> None:
    global _pool
    _pool = aioredis.ConnectionPool.from_url(
        settings.redis_url,
        max_connections=settings.redis_max_connections,
        decode_responses=True,
    )
    logger.info(
        "Redis 连接池初始化完成: %s (max_connections=%d)",
        settings.redis_url,
        settings.redis_max_connections,
    )


async def disconnect() -> None:
    global _pool
    if _pool:
        await _pool.disconnect()
        _pool = None
        logger.info("Redis 连接池已关闭")


async def stream_turn_output(
    session_id: str,
    turn_id: str,
    start_seq: str = "0",
) -> AsyncGenerator[dict[str, Any], None]:
    """
    从 Redis Stream 持续拉取指定轮次的输出事件。
    stream key: session:{session_id}:turn:{turn_id}:stream
    """
    turn_stream_key = f"session:{session_id}:turn:{turn_id}:stream"
    async for item in stream_session_output(session_id, start_seq, stream_key_override=turn_stream_key):
        yield item


async def stream_session_output(
    session_id: str,
    start_seq: str = "0",
    stream_key_override: str | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """
    从 Redis Stream 持续拉取 session 输出事件。
    start_seq: Redis Stream 的消息 ID（"0" 表示从头开始）
    每次 XREAD 阻塞 sse_block_ms 毫秒，超时则 yield 心跳后继续。
    """
    client = get_redis()
    stream_key = stream_key_override or _get_stream_key(session_id)
    last_id = start_seq if start_seq not in ("0", "") else "0-0"
    heartbeat_count = 0

    logger.info("开始读取 Redis Stream: key=%s start_seq=%s", stream_key, start_seq)

    while True:
        results = await client.xread(
            streams={stream_key: last_id},
            block=settings.sse_block_ms,
            count=50,
        )
        if not results:
            heartbeat_count += 1
            # 每隔 10 次心跳（约 10 * sse_block_ms）打一次日志，避免刷屏
            if heartbeat_count % 10 == 1:
                logger.debug("session %s: 等待 Redis Stream 中（心跳 #%d，last_id=%s）",
                             session_id, heartbeat_count, last_id)
            yield {"heartbeat": True}
            continue

        for _key, messages in results:
            batch_size = len(messages)
            logger.debug("session %s: 读取到 %d 条消息（last_id=%s）", session_id, batch_size, last_id)

            for msg_id, fields in messages:
                last_id = msg_id
                event_type = fields.get("event_type", "unknown")

                if event_type in ("done", "error", "cancelled"):
                    logger.info("session %s: Redis Stream 终止事件 event_type=%s msg_id=%s",
                                session_id, event_type, msg_id)

                yield {"id": msg_id, **fields}

                if event_type == "done":
                    return
