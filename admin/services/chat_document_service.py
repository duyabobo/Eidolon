"""
对话附件入库：获取 knowledge_key → 确保「会话附件」知识库 → 调用 knowledge 上传。

远程模式走 mRAG；本地模式走 admin 本地知识库存储。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from io import BytesIO

from fastapi import UploadFile
from starlette.datastructures import Headers

from constants.knowledge import CHAT_UPLOAD_KB_DESCRIPTION, CHAT_UPLOAD_KB_NAME
from models.knowledge import KnowledgeBaseCreate
from services import knowledge_client, knowledge_config_store, mongo_client
from services.knowledge_store import create_base as local_create_base
from services.knowledge_store import list_bases as local_list_bases
from services.knowledge_store import upload_document as local_upload_document

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ChatKnowledgeUploadResult:
    doc_id: str
    kb_id: str
    knowledge_key: str | None
    status: str


def _upload_file_from_bytes(filename: str, content: bytes, content_type: str | None) -> UploadFile:
    return UploadFile(
        file=BytesIO(content),
        filename=filename,
        headers=Headers({"content-type": content_type or "application/octet-stream"}),
    )


async def _ensure_remote_chat_kb(knowledge_key: str) -> str:
    listed = await knowledge_client.list_bases(knowledge_key, page=1, page_size=100)
    for item in listed.items:
        if item.name == CHAT_UPLOAD_KB_NAME:
            return item.id
    created = await knowledge_client.create_base(
        knowledge_key,
        KnowledgeBaseCreate(
            name=CHAT_UPLOAD_KB_NAME,
            description=CHAT_UPLOAD_KB_DESCRIPTION,
            type="document",
        ),
    )
    logger.info("已创建对话附件知识库 kb_id=%s name=%s", created.id, CHAT_UPLOAD_KB_NAME)
    return created.id


async def _ensure_local_chat_kb() -> str:
    db = mongo_client.get_db()
    listed = await local_list_bases(db, page=1, page_size=100)
    for item in listed.items:
        if item.name == CHAT_UPLOAD_KB_NAME:
            return item.id
    created = await local_create_base(
        db,
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
) -> ChatKnowledgeUploadResult:
    """将对话上传文件写入 knowledge，并返回 doc_id / kb_id。"""
    upload = _upload_file_from_bytes(filename, content, content_type)

    if await knowledge_config_store.is_remote_mode():
        key_resp = await knowledge_client.fetch_knowledge_key(user_id)
        knowledge_key = key_resp.knowledge_key
        kb_id = await _ensure_remote_chat_kb(knowledge_key)
        doc = await knowledge_client.upload_document(knowledge_key, kb_id, upload)
        logger.info(
            "对话附件已上传 mRAG user=%s kb_id=%s doc_id=%s file=%s",
            user_id, kb_id, doc.id, filename,
        )
        return ChatKnowledgeUploadResult(
            doc_id=doc.id,
            kb_id=kb_id,
            knowledge_key=knowledge_key,
            status=doc.status,
        )

    kb_id = await _ensure_local_chat_kb()
    doc = await local_upload_document(mongo_client.get_db(), kb_id, upload)
    logger.info(
        "对话附件已上传本地知识库 user=%s kb_id=%s doc_id=%s file=%s",
        user_id, kb_id, doc.id, filename,
    )
    return ChatKnowledgeUploadResult(
        doc_id=doc.id,
        kb_id=kb_id,
        knowledge_key=None,
        status=doc.status,
    )
