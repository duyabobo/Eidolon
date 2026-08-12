import logging

from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from sse_starlette.sse import EventSourceResponse

from cm_server.gateway_sse.services import event_store, session_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["stream"])

_HEARTBEAT_EVENT = "heartbeat"


def resolve_resume_seq(last_seq: str, last_event_id: str | None) -> int:
    """
    解析 SSE 恢复游标为 turn_events 表的 seq（原 Redis Stream 消息 ID）。

    浏览器原生 EventSource 断线重连时会携带 Last-Event-ID。显式传入的 last_seq
    优先级更高，便于非浏览器客户端主动恢复；两者都缺省或非数字时从 0（全量回放）开始。
    """
    raw = last_seq if last_seq != "0" else (last_event_id or "0")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


@router.get("/{session_id}/turns/{turn_id}/stream")
async def stream_turn(
    request: Request,
    session_id: str,
    turn_id: str,
    last_seq: str = Query(default="0"),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> EventSourceResponse:
    """
    SSE 接口：订阅指定轮次（turn）的输出流。
    前端在发送消息后用此接口实时接收 pi 的响应；历史事件回放 + 实时推送均来自本地 SQLite `turn_events` 表。
    """
    session = await session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session 不存在")

    resume_seq = resolve_resume_seq(last_seq, last_event_id)
    logger.info(
        "Turn SSE 连接建立: session_id=%s turn_id=%s last_seq=%s last_event_id=%s resume_seq=%d",
        session_id, turn_id, last_seq, last_event_id, resume_seq,
    )

    async def event_generator():
        event_count = 0
        async for item in event_store.stream_turn_events(session_id, turn_id, after_seq=resume_seq):
            if await request.is_disconnected():
                logger.info(
                    "Turn SSE 客户端断开: session_id=%s turn_id=%s 累计推送=%d",
                    session_id, turn_id, event_count,
                )
                return
            if item.get("heartbeat"):
                yield {"event": _HEARTBEAT_EVENT, "data": ""}
                continue

            event_type = item.get("event_type", "token")
            event_count += 1
            if event_count == 1:
                logger.info(
                    "Turn SSE 首条事件: session_id=%s turn_id=%s event_type=%s",
                    session_id, turn_id, event_type,
                )
            yield {"event": event_type, "id": item.get("id"), "data": item.get("content", "")}

            if event_type in ("done", "cancelled"):
                logger.info(
                    "Turn SSE 结束: session_id=%s turn_id=%s event_type=%s 累计推送=%d",
                    session_id, turn_id, event_type, event_count,
                )
                return

    return EventSourceResponse(
        event_generator(),
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
