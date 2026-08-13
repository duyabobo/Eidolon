"""对话附件知识库入库（本地 SQLite + 文件系统 + 入队处理）。"""
from __future__ import annotations

import logging
from io import BytesIO

from fastapi import UploadFile
from pi_shared.workspace import KnowledgeUploadResult
from starlette.datastructures import Headers

from cm_server.admin.constants.knowledge import CHAT_UPLOAD_KB_DESCRIPTION, CHAT_UPLOAD_KB_NAME
from cm_server.admin.models.knowledge import KnowledgeBaseCreate
from cm_server.admin.services.knowledge_store import create_base as local_create_base
from cm_server.admin.services.knowledge_store import list_bases as local_list_bases
from cm_server.admin.services.knowledge_store import upload_document as local_upload_document

logger = logging.getLogger(__name__)


def _upload_file_from_bytes(filename: str, content: bytes, content_type: str | None) -> UploadFile:
    return UploadFile(
        file=BytesIO(content),
        filename=filename,
        headers=Headers({"content-type": content_type or "application/octet-stream"}),
    )


async def _ensure_local_chat_kb() -> str:
    listed = await local_list_bases(page=1, page_size=100)
    for item in listed.items:
        if item.name == CHAT_UPLOAD_KB_NAME:
            return item.id
    created = await local_create_base(
        KnowledgeBaseCreate(
            name=CHAT_UPLOAD_KB_NAME,
            description=CHAT_UPLOAD_KB_DESCRIPTION,
            type="document",
        ),
    )
    logger.info("已创建本地对话附件知识库 kb_id=%s", created.id)
    return created.id


async def upload_chat_document_to_knowledge(
    *,
    user_id: str,
    filename: str,
    content: bytes,
    content_type: str | None,
) -> KnowledgeUploadResult:
    """将对话上传文件写入本地 knowledge，并入队解析。"""
    upload = _upload_file_from_bytes(filename, content, content_type)
    kb_id = await _ensure_local_chat_kb()
    doc = await local_upload_document(kb_id, upload, process=True)
    logger.info(
        "对话附件已上传本地知识库 user=%s kb_id=%s doc_id=%s file=%s",
        user_id,
        kb_id,
        doc.id,
        filename,
    )
    return KnowledgeUploadResult(
        doc_id=doc.id,
        kb_id=kb_id,
        status=doc.status,
        knowledge_key=None,
    )
