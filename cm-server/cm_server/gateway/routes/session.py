import logging
import time
import uuid

from fastapi import APIRouter, HTTPException, Query, status

from cm_server.gateway.models.session import (
    CreateSessionRequest, CreateSessionResponse, SendMessageRequest,
    SendMessageResponse, SessionDocument, SessionStatus, SessionSummary,
)
from cm_server.gateway.services import session_store, task_dispatch

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["session"])


@router.post("", response_model=CreateSessionResponse, status_code=status.HTTP_200_OK)
async def create_session(body: CreateSessionRequest) -> CreateSessionResponse:
    """
    创建新 session（打开新 chat 窗口 + 发送第一条消息）。
    每次新对话都落一条新记录，保证历史列表立刻可见；先写 SQLite 再投递执行任务。
    session_id 由后端生成，前端需提供 turn_id（供 SSE stream 订阅）。

    defer_start=True：只建会话、不投递任务（先上传附件，再由 /messages 启动首轮）。
    """
    session_id = str(uuid.uuid4())
    logger.info(
        "新建 session: session_id=%s user=%s turn_id=%s skill_ids=%s defer=%s request='%s'",
        session_id, body.user_id, body.turn_id, body.skill_ids, body.defer_start,
        body.request[:80].replace("\n", " "),
    )

    initial_status = SessionStatus.IDLE if body.defer_start else SessionStatus.PENDING
    await session_store.create_session(
        session_id, body.user_id, body.request, body.skill_ids,
        status=initial_status,
        skip_initial_user_message=body.defer_start,
    )
    if not body.defer_start:
        await task_dispatch.publish_task(
            session_id, body.user_id, body.request, body.turn_id, body.skill_ids,
        )

    return CreateSessionResponse(
        session_id=session_id,
        status=initial_status,
        deferred=body.defer_start,
    )


@router.post("/{session_id}/messages", response_model=SendMessageResponse, status_code=status.HTTP_200_OK)
async def send_message(session_id: str, body: SendMessageRequest) -> SendMessageResponse:
    """
    向已有 session 发送新消息（新轮次）。
    前端提供 turn_id，发送后订阅 /sessions/{session_id}/turns/{turn_id}/stream 获取响应。

    IDLE 状态（沙盒因闲置超时被回收）时自动重建沙盒并继续会话；
    COMPLETED/FAILED（用户主动关闭或异常终止）才真正拒绝。
    """
    session = await session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session 不存在")

    # SQLite 只存用户原文；附件元数据已由 user_file 事件单独落库
    display_request = body.request
    agent_request = (body.agent_request or body.request).strip() or body.request
    logger.info(
        "新消息: session_id=%s turn_id=%s status=%s request='%s' agent_len=%d",
        session_id, body.turn_id, session.status,
        display_request[:80].replace("\n", " "), len(agent_request),
    )

    # 用户消息持久化到 events_snapshot，与第一条消息保持一致
    # 必须在 publish 之前写入，确保 AI 响应事件追加时用户消息已在前
    await session_store.append_event_snapshot(
        session_id,
        {"event_type": "user_message", "content": display_request, "ts": int(time.time() * 1000)},
    )

    if session.status in (SessionStatus.IDLE, SessionStatus.COMPLETED, SessionStatus.FAILED):
        # 沙盒已回收或 session 已关闭：通过 publish_task 重新拉起沙盒，视觉历史由 events_snapshot 保留
        logger.info("session 沙盒不存在（status=%s），重新拉起沙盒: session_id=%s", session.status, session_id)
        await task_dispatch.publish_task(
            session_id, session.user_id, agent_request, body.turn_id, body.skill_ids,
        )
    else:
        await task_dispatch.publish_message(
            session_id, session.user_id, agent_request, body.turn_id, body.skill_ids,
        )

    return SendMessageResponse(turn_id=body.turn_id, session_id=session_id)


@router.post("/{session_id}/turns/{turn_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_turn(session_id: str, turn_id: str) -> None:
    """中断指定轮次的生成任务，已产出内容立即入库。"""
    session = await session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session 不存在")

    await task_dispatch.publish_cancel(session_id, turn_id)
    logger.info("中断请求: session_id=%s turn_id=%s", session_id, turn_id)


@router.get("/{session_id}/active_turn")
async def get_session_active_turn(session_id: str) -> dict[str, str | None]:
    """查询 session 当前进行中的 turn_id（无则返回 null）。"""
    session = await session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session 不存在")
    turn_id = await task_dispatch.get_active_turn(session_id)
    return {"turn_id": turn_id}


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def close_session(session_id: str) -> None:
    """关闭 session（用户关闭 chat 窗口），通知 pi-runtime 销毁 pi 进程和沙盒。"""
    session = await session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session 不存在")

    await task_dispatch.close_session(session_id)


@router.get("", response_model=list[SessionSummary])
async def list_sessions(
    user_id: str = Query(..., description="用户 ID"),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[SessionSummary]:
    """查询用户近期 session 列表"""
    return await session_store.get_recent_sessions(user_id, limit)


@router.get("/{session_id}", response_model=SessionDocument)
async def get_session(session_id: str) -> SessionDocument:
    """查询 session 详情"""
    session = await session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session 不存在")
    return session
