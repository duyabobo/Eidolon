"""会话附件上传：落盘 workspace + 本地知识库入库。"""
from __future__ import annotations

import logging
import time
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from pi_shared.workspace import (
    WorkspaceError,
    attachment_event_payload,
    persist_chat_attachment,
)
from pi_shared.workspace.constants import MAX_UPLOAD_BYTES
from pydantic import BaseModel, Field

from cm_server.admin.services.chat_document_service import upload_chat_document_to_knowledge
from cm_server.gateway.config import settings
from cm_server.gateway.services import session_store
from cm_server.shared.machine_uid import current_user_id
from cm_server.mrag.doc_status import update_document_fields

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
    summary="对话附件上传（session workspace + 本地知识库）",
)
async def session_upload(
    session_id: str,
    file: UploadFile = File(...),
) -> ChatUploadResponse:
    uid = await current_user_id()
    session = await session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    if session.user_id != uid:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该会话")

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="文件超过大小限制",
        )
    filename = file.filename or "upload.bin"
    content_type = file.content_type

    async def _upload_knowledge():
        return await upload_chat_document_to_knowledge(
            user_id=uid,
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

    await update_document_fields(
        result.doc_id,
        source_file_path=str(Path(result.stored_path).resolve()),
    )
    event = attachment_event_payload(result, int(time.time() * 1000))
    await session_store.append_event_snapshot(session_id, event)
    logger.info(
        "会话附件已入库 session=%s user=%s doc_id=%s file=%s source=%s",
        session_id, uid, result.doc_id, result.filename, result.stored_path,
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
