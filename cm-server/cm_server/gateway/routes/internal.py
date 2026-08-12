"""内部 API：仅供 pi-runtime 调用，用于回写 session 状态与事件快照。

CM 架构下 pi-runtime（Node 进程）不直接访问 SQLite 文件（避免与 Python `aiosqlite`
争抢同一文件的并发写入语义），而是把 session 生命周期数据通过本机 HTTP 写回 gateway，
由 gateway 统一落库；对应原 pi-runtime `mongo-client.ts` 里 `updateSessionStatus`/
`appendEventSnapshot` 两个写入点。
"""
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from cm_server.gateway.models.session import SessionStatus
from cm_server.gateway.services import session_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal/sessions", tags=["internal"])


class UpdateStatusRequest(BaseModel):
    status: SessionStatus


class AppendEventsRequest(BaseModel):
    events: list[dict[str, Any]]


@router.post("/{session_id}/status", status_code=status.HTTP_204_NO_CONTENT)
async def update_status(session_id: str, body: UpdateStatusRequest) -> None:
    session = await session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session 不存在")
    await session_store.update_session_status(session_id, body.status)


@router.post("/{session_id}/events", status_code=status.HTTP_204_NO_CONTENT)
async def append_events(session_id: str, body: AppendEventsRequest) -> None:
    await session_store.append_event_snapshot_batch(session_id, body.events)
