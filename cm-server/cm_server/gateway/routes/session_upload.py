"""会话附件上传：落盘 workspace + mRAG 入库（对话域，属 gateway）。"""
from __future__ import annotations

import logging
import time

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from pi_shared.knowledge import (
    MragError,
    load_mrag_base_url,
    upload_chat_attachment_to_mrag,
)
from pi_shared.workspace import (
    WorkspaceError,
    attachment_event_payload,
    persist_chat_attachment,
)
from pydantic import BaseModel, Field

from cm_server.gateway.config import settings
from cm_server.gateway.services import session_store
from cm_server.gateway.services.db import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["session-upload"])


class ChatUploadResponse(BaseModel):
    filename: str
    relative_path: str
    stored_path: str
    size: int
    doc_id: str
    kb_id: str
    knowledge_status: str = Field(default="uploaded")


@router.post(
    "/{session_id}/upload",
    response_model=ChatUploadResponse,
    summary="对话附件上传（session workspace + mRAG）",
)
async def session_upload(
    session_id: str,
    user_id: str = Query(..., description="用户 ID"),
    file: UploadFile = File(...),
) -> ChatUploadResponse:
    uid = (user_id or "").strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先设置用户 ID")

    session = await session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    if session.user_id != uid:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该会话")

    data = await file.read()
    filename = file.filename or "upload.bin"
    content_type = file.content_type

    base_url = await load_mrag_base_url(get_db())
    if not base_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="未配置 mRAG 服务地址；本地 knowledge 模式请在 Admin 配置远程环境后再上传",
        )

    async def _upload_knowledge():
        return await upload_chat_attachment_to_mrag(
            base_url=base_url,
            scene_uid=uid,
            filename=filename,
            content=data,
            content_type=content_type,
        )

    try:
        result = await persist_chat_attachment(
            sandbox_root=settings.sandbox_root,
            user_id=uid,
            session_id=session_id,
            filename=filename,
            content=data,
            upload_to_knowledge=_upload_knowledge,
        )
    except WorkspaceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except MragError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    event = attachment_event_payload(result, int(time.time() * 1000))
    await session_store.append_event_snapshot(session_id, event)
    logger.info(
        "会话附件已入库 session=%s user=%s doc_id=%s file=%s",
        session_id, uid, result.doc_id, result.filename,
    )
    return ChatUploadResponse(
        filename=result.filename,
        relative_path=result.relative_path,
        stored_path=result.stored_path,
        size=result.size,
        doc_id=result.doc_id,
        kb_id=result.kb_id,
        knowledge_status=result.knowledge_status,
    )
