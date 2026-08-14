"""文档状态读写（异步 SQLite）。"""
from __future__ import annotations

import logging

from pi_shared import format_iso, now_china

from cm_server.admin.constants.knowledge import (
    DOC_STATUS_FAILED,
    DOC_STATUS_INDEXED,
    DOC_STATUS_PROCESSING,
    DOC_STATUS_UPLOADED,
)
from cm_server.admin.services.db import get_db

logger = logging.getLogger(__name__)

_ERROR_MESSAGE_MAX_CHARS = 2000


def map_public_status(row: dict) -> str:
    status = str(row.get("status") or DOC_STATUS_UPLOADED)
    wiki_compiled = bool(row.get("wiki_compiled"))
    if status == DOC_STATUS_INDEXED or (status == "processed" and wiki_compiled):
        return DOC_STATUS_INDEXED
    if status in {DOC_STATUS_PROCESSING, "pending"}:
        return DOC_STATUS_PROCESSING
    if status == DOC_STATUS_FAILED:
        return DOC_STATUS_FAILED
    if status == "processed" and not wiki_compiled:
        return DOC_STATUS_PROCESSING
    return DOC_STATUS_UPLOADED


async def get_document_row(doc_id: str) -> dict | None:
    return await get_db().fetch_one(
        "SELECT * FROM knowledge_documents WHERE id = ?",
        (doc_id,),
    )


async def update_document_fields(
    doc_id: str,
    *,
    status: str | None = None,
    error_message: str | None = None,
    wiki_compiled: bool | None = None,
    track_id: str | None = None,
    source_file_path: str | None = None,
) -> None:
    fields: list[str] = ["updated_at = ?"]
    params: list = [format_iso(now_china())]
    if status is not None:
        fields.append("status = ?")
        params.append(status)
    if error_message is not None:
        fields.append("error_message = ?")
        params.append(error_message[:_ERROR_MESSAGE_MAX_CHARS] if error_message else None)
    if wiki_compiled is not None:
        fields.append("wiki_compiled = ?")
        params.append(1 if wiki_compiled else 0)
    if track_id is not None:
        fields.append("track_id = ?")
        params.append(track_id)
    if source_file_path is not None:
        fields.append("source_file_path = ?")
        params.append(source_file_path)
    params.append(doc_id)
    await get_db().execute(
        f"UPDATE knowledge_documents SET {', '.join(fields)} WHERE id = ?",
        tuple(params),
    )
    logger.info(
        "文档状态更新 doc_id=%s status=%s wiki_compiled=%s",
        doc_id,
        status,
        wiki_compiled,
    )


async def mark_processing(doc_id: str) -> None:
    await update_document_fields(
        doc_id,
        status=DOC_STATUS_PROCESSING,
        error_message="",
        wiki_compiled=False,
    )


async def mark_failed(doc_id: str, error_message: str) -> None:
    await update_document_fields(
        doc_id,
        status=DOC_STATUS_FAILED,
        error_message=error_message,
        wiki_compiled=False,
    )


async def mark_indexed(doc_id: str) -> None:
    await update_document_fields(
        doc_id,
        status=DOC_STATUS_INDEXED,
        error_message="",
        wiki_compiled=True,
    )
