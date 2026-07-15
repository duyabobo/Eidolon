import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

import redis.asyncio as aioredis

from config import settings

logger = logging.getLogger(__name__)

_pool: aioredis.ConnectionPool | None = None

# Redis Stream key 模板
STREAM_KEY = "session:{session_id}:stream"
# user → pi-runtime instance 的亲和映射，TTL 24h（用于 sticky session）
USER_INSTANCE_KEY = "user:{user_id}:instance"
USER_INSTANCE_TTL = 86400
# pi-runtime 实例心跳 key（TTL 60s，每 30s 刷新；key 不存在表示实例已下线）
INSTANCE_ALIVE_KEY = "pi:instance:{instance_id}:alive"


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
        max_connections=50,
        decode_responses=True,
    )
    logger.info("Redis 连接池初始化完成: %s", settings.redis_url)


async def disconnect() -> None:
    global _pool
    if _pool:
        await _pool.disconnect()
        _pool = None
        logger.info("Redis 连接池已关闭")


async def publish_task(
    session_id: str,
    user_id: str,
    request: str,
    turn_id: str,
    skill_ids: list[str] | None = None,
) -> None:
    """
    写入可靠任务 Stream，创建 session 并发送第一条消息。

    任务以 session_id + turn_id 作为幂等键。重复 HTTP 请求会写入同一个
    task_id，执行层通过任务状态和租约锁抑制重复执行。
    """
    await _enqueue_task(
        task_type="start",
        session_id=session_id,
        user_id=user_id,
        request=request,
        turn_id=turn_id,
        skill_ids=skill_ids,
    )
    await set_active_turn(session_id, turn_id)


async def publish_message(
    session_id: str,
    user_id: str,
    request: str,
    turn_id: str,
    skill_ids: list[str] | None = None,
) -> None:
    """向已有 session 发送新轮次，写入可靠任务 Stream。"""
    await _enqueue_task(
        task_type="message",
        session_id=session_id,
        user_id=user_id,
        request=request,
        turn_id=turn_id,
        skill_ids=skill_ids,
    )
    await set_active_turn(session_id, turn_id)


async def _enqueue_task(
    *,
    task_type: str,
    session_id: str,
    user_id: str,
    request: str,
    turn_id: str,
    skill_ids: list[str] | None,
) -> None:
    task_id = f"{session_id}:{turn_id}"
    task_dedupe_key = f"agent:task:{task_id}:enqueued"
    client = get_redis()

    # SET NX 与 XADD 在 Lua 脚本内原子执行：同一 task_id 仅入队一次。
    script = """
    if redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1]) then
        return redis.call(
            'XADD', KEYS[2], '*',
            'task_id', ARGV[2],
            'task_type', ARGV[3],
            'session_id', ARGV[4],
            'user_id', ARGV[5],
            'request', ARGV[6],
            'turn_id', ARGV[7],
            'skill_ids', ARGV[8]
        )
    end
    return false
    """
    message_id = await client.eval(
        script,
        2,
        task_dedupe_key,
        settings.task_stream,
        str(settings.task_dedupe_ttl_seconds),
        task_id,
        task_type,
        session_id,
        user_id,
        request,
        turn_id,
        json.dumps(skill_ids or []),
    )
    if message_id:
        logger.info(
            "任务已写入 Stream: task_id=%s type=%s stream=%s message_id=%s",
            task_id,
            task_type,
            settings.task_stream,
            message_id,
        )
        return

    logger.info("重复任务已抑制: task_id=%s type=%s", task_id, task_type)


async def set_active_turn(session_id: str, turn_id: str) -> None:
    """记录 session 当前进行中的 turn，供切换会话后重连 SSE。"""
    await get_redis().setex(f"session:{session_id}:active_turn", 3600, turn_id)


async def get_active_turn(session_id: str) -> str | None:
    return await get_redis().get(f"session:{session_id}:active_turn")


async def clear_active_turn(session_id: str) -> None:
    await get_redis().delete(f"session:{session_id}:active_turn")


async def publish_cancel(session_id: str, turn_id: str) -> None:
    """通知 pi-runtime 中断指定轮次的生成任务。"""
    channel = f"sessions:{session_id}:cancel"
    payload = json.dumps({"turn_id": turn_id})
    await get_redis().publish(channel, payload)
    logger.info("中断信号已发布: session=%s turn=%s channel=%s", session_id, turn_id, channel)


async def bind_user_to_instance(user_id: str, instance_id: str) -> None:
    """
    pi-runtime 实例认领任务后，将 user → instance 绑定关系写入 Redis。
    由 pi-runtime 通过独立接口或消息回写；gateway 此处提供写入方法供统一管理。
    """
    client = get_redis()
    key = USER_INSTANCE_KEY.format(user_id=user_id)
    await client.setex(key, USER_INSTANCE_TTL, instance_id)
    logger.info("user 实例绑定: user=%s → instance=%s TTL=%ds", user_id, instance_id, USER_INSTANCE_TTL)


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
