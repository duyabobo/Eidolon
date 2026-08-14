"""会话 uploads 与 knowledge 文档关联：入库解析、列表挂图谱元数据。"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import HTTPException
from pi_shared.workspace.paths import is_session_uploads_rel, resolve_under_user

from cm_server.admin.config import settings
from cm_server.admin.constants.knowledge import ALLOWED_EXTENSIONS
from cm_server.admin.services.chat_document_service import upload_chat_document_to_knowledge
from cm_server.admin.services.knowledge_store import (
    list_documents_by_source_paths,
    list_documents_by_source_suffixes,
)
from cm_server.mrag.doc_status import map_public_status, update_document_fields

logger = logging.getLogger(__name__)

_NAV_NAMES = {".", ".."}


def _abs_source_path(user_id: str, rel_path: str) -> str:
    dest_abs, _ = resolve_under_user(settings.sandbox_root, user_id, rel_path)
    return str(dest_abs.resolve())


async def ingest_session_upload(
    user_id: str,
    dest_rel: str,
    filename: str,
    content: bytes,
    content_type: str | None,
) -> None:
    """workspace 写入会话 uploads 后入队 wiki；非该分区或类型不支持则跳过。"""
    if not is_session_uploads_rel(dest_rel):
        return
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        logger.info("会话 uploads 跳过 wiki：不支持的类型 path=%s", dest_rel)
        return
    try:
        knowledge = await upload_chat_document_to_knowledge(
            user_id=user_id,
            filename=filename,
            content=content,
            content_type=content_type,
        )
    except HTTPException as exc:
        logger.warning(
            "会话 uploads wiki 入库失败 path=%s status=%s detail=%s",
            dest_rel,
            exc.status_code,
            exc.detail,
        )
        return
    source = _abs_source_path(user_id, dest_rel)
    await update_document_fields(knowledge.doc_id, source_file_path=source)
    logger.info(
        "会话 uploads 已入队 wiki path=%s doc_id=%s",
        dest_rel,
        knowledge.doc_id,
    )


def _attach_row(entry: dict, row: dict) -> None:
    entry["doc_id"] = str(row["id"])
    entry["kb_id"] = str(row["kb_id"])
    entry["wiki_compiled"] = bool(row.get("wiki_compiled"))
    entry["knowledge_status"] = map_public_status(row)


async def attach_knowledge_to_listing(user_id: str, listing: dict) -> dict:
    """给会话 uploads 下的文件挂 doc_id / kb_id，供前端图谱按钮使用。"""
    entries = listing.get("entries") or []
    file_entries = [
        entry
        for entry in entries
        if not entry.get("is_dir")
        and entry.get("name") not in _NAV_NAMES
        and is_session_uploads_rel(str(entry.get("path") or ""))
    ]
    if not file_entries:
        return listing

    abs_by_rel = {
        str(entry["path"]): _abs_source_path(user_id, str(entry["path"]))
        for entry in file_entries
    }
    docs = await list_documents_by_source_paths(list(dict.fromkeys(abs_by_rel.values())))
    for entry in file_entries:
        row = docs.get(abs_by_rel[str(entry["path"])])
        if row:
            _attach_row(entry, row)
    unmatched = [entry for entry in file_entries if not entry.get("doc_id")]
    if unmatched:
        extra = await list_documents_by_source_suffixes(
            [str(entry["path"]) for entry in unmatched],
        )
        for entry in unmatched:
            row = extra.get(str(entry["path"]))
            if row:
                _attach_row(entry, row)
    attached = sum(1 for entry in file_entries if entry.get("doc_id"))
    logger.info(
        "workspace ls 挂载 wiki 元数据 user=%s files=%d attached=%d",
        user_id,
        len(file_entries),
        attached,
    )
    return listing
