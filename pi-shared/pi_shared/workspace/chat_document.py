"""对话附件编排：知识库入库 + session workspace 落盘（admin / gateway 共用）。"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from pi_shared.workspace.errors import WorkspaceError
from pi_shared.workspace.ops import save_session_workspace_upload

logger = logging.getLogger(__name__)

KnowledgeUploader = Callable[[], Awaitable["KnowledgeUploadResult"]]


@dataclass(frozen=True)
class KnowledgeUploadResult:
    doc_id: str
    kb_id: str
    knowledge_key: str | None
    status: str


@dataclass(frozen=True)
class ChatAttachmentResult:
    filename: str
    relative_path: str
    stored_path: str
    size: int
    doc_id: str
    kb_id: str
    knowledge_status: str


async def persist_chat_attachment(
    *,
    sandbox_root: str,
    user_id: str,
    session_id: str,
    filename: str,
    content: bytes,
    upload_to_knowledge: KnowledgeUploader,
) -> ChatAttachmentResult:
    """
    先知识库入库，再落盘到 session workspace/uploads，避免半成功。
    upload_to_knowledge 由调用方注入（admin 本地实现 / gateway HTTP 调 admin）。
    """
    knowledge = await upload_to_knowledge()
    try:
        disk = save_session_workspace_upload(
            sandbox_root, user_id, session_id, filename, content,
        )
    except WorkspaceError:
        logger.error(
            "对话附件落盘失败（知识库已入库）user=%s session=%s doc_id=%s file=%s",
            user_id, session_id, knowledge.doc_id, filename,
        )
        raise

    logger.info(
        "对话附件已持久化 user=%s session=%s doc_id=%s file=%s",
        user_id, session_id, knowledge.doc_id, disk["filename"],
    )
    return ChatAttachmentResult(
        filename=str(disk["filename"]),
        relative_path=str(disk["relative_path"]),
        stored_path=str(disk["stored_path"]),
        size=int(disk["size"]),
        doc_id=knowledge.doc_id,
        kb_id=knowledge.kb_id,
        knowledge_status=knowledge.status,
    )


def attachment_event_payload(result: ChatAttachmentResult, ts_ms: int) -> dict[str, Any]:
    return {
        "event_type": "user_file",
        "content": result.filename,
        "filename": result.filename,
        "relative_path": result.relative_path,
        "size": result.size,
        "doc_id": result.doc_id,
        "kb_id": result.kb_id,
        "knowledge_status": result.knowledge_status,
        "ts": ts_ms,
    }
