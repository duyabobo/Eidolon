"""本地知识库：SQLite 元数据 + 本地文件 + 上传后入队 parse/understand。"""
import logging
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from pi_shared import format_iso, now_china
from pi_shared.sqlite import dumps, loads

from cm_server.admin.config import settings
from cm_server.admin.constants.knowledge import (
    ALLOWED_EXTENSIONS,
    CHAT_UPLOAD_KB_NAME,
    DOC_STATUS_PROCESSING,
)
from cm_server.admin.models.knowledge import (
    ChunkingConfig,
    KnowledgeBase,
    KnowledgeBaseCreate,
    KnowledgeBaseList,
    KnowledgeBaseUpdate,
    KnowledgeDocument,
    KnowledgeDocumentList,
)
from cm_server.admin.services import knowledge_pipeline_store
from cm_server.admin.services.db import get_db
from cm_server.mrag import storage
from cm_server.mrag.doc_status import map_public_status
from cm_server.mrag.jobs import enqueue_document_processing

logger = logging.getLogger(__name__)


def _row_to_kb(row: dict, doc_count: int = 0) -> KnowledgeBase:
    parsed = loads(row.get("chunking_config"), None)
    return KnowledgeBase(
        id=str(row["id"]),
        name=row["name"],
        description=row.get("description", ""),
        type=row.get("type", "document"),
        document_count=doc_count,
        chunking_config=ChunkingConfig(**parsed) if parsed else None,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_doc(row: dict) -> KnowledgeDocument:
    return KnowledgeDocument(
        id=str(row["id"]),
        kb_id=row["kb_id"],
        name=row["name"],
        file_size=int(row.get("file_size", 0)),
        status=map_public_status(row),  # type: ignore[arg-type]
        error_message=row.get("error_message"),
        wiki_compiled=bool(row.get("wiki_compiled")),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def _count_docs(kb_id: str) -> int:
    row = await get_db().fetch_one(
        "SELECT COUNT(*) AS n FROM knowledge_documents WHERE kb_id = ?",
        (kb_id,),
    )
    return int(row["n"]) if row else 0


async def list_bases(page: int, page_size: int, *, exclude_hidden: bool = False) -> KnowledgeBaseList:
    db = get_db()
    offset = (page - 1) * page_size
    where = "WHERE name != :hidden_name" if exclude_hidden else ""
    params: dict = {"hidden_name": CHAT_UPLOAD_KB_NAME, "limit": page_size, "offset": offset}

    total_row = await db.fetch_one(f"SELECT COUNT(*) AS n FROM knowledge_bases {where}", params)
    total = int(total_row["n"]) if total_row else 0

    rows = await db.fetch_all(
        f"SELECT * FROM knowledge_bases {where} ORDER BY updated_at DESC LIMIT :limit OFFSET :offset",
        params,
    )
    items = [_row_to_kb(row, await _count_docs(str(row["id"]))) for row in rows]
    return KnowledgeBaseList(items=items, total=total, page=page, page_size=page_size)


async def get_base(kb_id: str) -> KnowledgeBase:
    row = await get_db().fetch_one("SELECT * FROM knowledge_bases WHERE id = ?", (kb_id,))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="知识库不存在")
    return _row_to_kb(row, await _count_docs(kb_id))


async def create_base(body: KnowledgeBaseCreate) -> KnowledgeBase:
    now = format_iso(now_china())
    kb_id = str(uuid.uuid4())
    chunking_config = dumps(body.chunking_config.model_dump()) if body.chunking_config else None
    await get_db().execute(
        """
        INSERT INTO knowledge_bases (id, name, description, type, chunking_config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (kb_id, body.name.strip(), body.description.strip(), body.type, chunking_config, now, now),
    )
    (storage.knowledge_root() / kb_id).mkdir(parents=True, exist_ok=True)
    logger.info("知识库已创建 id=%s name=%s", kb_id, body.name)
    return await get_base(kb_id)


async def update_base(kb_id: str, body: KnowledgeBaseUpdate) -> KnowledgeBase:
    await get_base(kb_id)
    now = format_iso(now_china())

    fields: list[str] = []
    params: list = []
    if body.name is not None:
        fields.append("name = ?")
        params.append(body.name.strip())
    if body.description is not None:
        fields.append("description = ?")
        params.append(body.description.strip())
    if body.chunking_config is not None:
        fields.append("chunking_config = ?")
        params.append(dumps(body.chunking_config.model_dump()))
    fields.append("updated_at = ?")
    params.append(now)
    params.append(kb_id)

    await get_db().execute(
        f"UPDATE knowledge_bases SET {', '.join(fields)} WHERE id = ?",
        tuple(params),
    )
    return await get_base(kb_id)


async def delete_base(kb_id: str) -> None:
    await get_base(kb_id)
    db = get_db()
    await db.execute("DELETE FROM knowledge_documents WHERE kb_id = ?", (kb_id,))
    await db.execute("DELETE FROM knowledge_bases WHERE id = ?", (kb_id,))
    storage.delete_kb_files(kb_id)
    logger.info("知识库已删除 id=%s", kb_id)


async def list_documents(kb_id: str, page: int, page_size: int) -> KnowledgeDocumentList:
    await get_base(kb_id)
    db = get_db()
    offset = (page - 1) * page_size
    total_row = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM knowledge_documents WHERE kb_id = ?",
        (kb_id,),
    )
    total = int(total_row["n"]) if total_row else 0
    rows = await db.fetch_all(
        "SELECT * FROM knowledge_documents WHERE kb_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (kb_id, page_size, offset),
    )
    return KnowledgeDocumentList(
        items=[_row_to_doc(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


async def get_document(kb_id: str, doc_id: str) -> KnowledgeDocument:
    row = await get_db().fetch_one(
        "SELECT * FROM knowledge_documents WHERE id = ? AND kb_id = ?",
        (doc_id, kb_id),
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    return _row_to_doc(row)


def document_file_path(kb_id: str, doc_id: str, filename: str) -> Path:
    return storage.resolve_original_file(kb_id, doc_id, filename)


async def upload_document(
    kb_id: str,
    upload: UploadFile,
    *,
    process: bool = True,
    owner_user_id: str | None = None,
) -> KnowledgeDocument:
    await get_base(kb_id)
    if process:
        await knowledge_pipeline_store.require_mineru_configured()

    filename = (upload.filename or "unnamed").strip()
    if not filename or filename in (".", "..") or "\\" in filename or Path(filename).name != filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="非法文件名",
        )
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的文件类型 {suffix}，允许: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # 限定单次读取字节数，避免超大文件在大小校验前就整体读入内存
    max_bytes = settings.knowledge_max_file_bytes
    content = await upload.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"文件不能超过 {max_bytes // (1024 * 1024)}MB",
        )

    now = format_iso(now_china())
    doc_id = str(uuid.uuid4())
    owner = (owner_user_id or "").strip()
    target_dir = storage.doc_dir(kb_id, doc_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    original = target_dir / filename
    original.write_bytes(content)
    source_file_path = str(original.resolve())

    initial_status = DOC_STATUS_PROCESSING if process else "uploaded"
    db = get_db()
    await db.execute(
        """
        INSERT INTO knowledge_documents
            (id, kb_id, name, file_size, status, error_message, wiki_compiled, file_format, track_id, owner_user_id, source_file_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, 0, ?, '', ?, ?, ?, ?)
        """,
        (doc_id, kb_id, filename, len(content), initial_status, suffix.lstrip("."), owner, source_file_path, now, now),
    )
    await db.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (now, kb_id))
    logger.info(
        "文档已上传 kb=%s doc=%s file=%s size=%d process=%s owner=%s",
        kb_id, doc_id, filename, len(content), process, owner or "-",
    )

    if process:
        enqueue_document_processing(kb_id, doc_id)

    return await get_document(kb_id, doc_id)


async def list_documents_by_source_paths(source_paths: list[str]) -> dict[str, dict]:
    """按 source_file_path 批量查文档（会话 uploads 列表挂图谱用）。"""
    if not source_paths:
        return {}
    placeholders = ",".join("?" * len(source_paths))
    rows = await get_db().fetch_all(
        f"SELECT * FROM knowledge_documents WHERE source_file_path IN ({placeholders})",
        tuple(source_paths),
    )
    return {str(row["source_file_path"]): dict(row) for row in rows}


async def list_documents_by_source_suffixes(rel_paths: list[str]) -> dict[str, dict]:
    """兼容未 resolve 的旧 source_file_path：按相对路径后缀匹配。"""
    if not rel_paths:
        return {}
    clauses = " OR ".join(["source_file_path LIKE ?" for _ in rel_paths])
    rows = await get_db().fetch_all(
        f"SELECT * FROM knowledge_documents WHERE {clauses}",
        tuple(f"%/{rel}" for rel in rel_paths),
    )
    by_rel: dict[str, dict] = {}
    for row in rows:
        src = str(row.get("source_file_path") or "")
        for rel in rel_paths:
            if src.endswith(f"/{rel}") or src.endswith(rel):
                by_rel[rel] = dict(row)
    return by_rel


async def delete_document(kb_id: str, doc_id: str) -> None:
    await get_document(kb_id, doc_id)
    db = get_db()
    await db.execute("DELETE FROM knowledge_documents WHERE id = ?", (doc_id,))
    storage.delete_doc_files(kb_id, doc_id)
    await db.execute(
        "UPDATE knowledge_bases SET updated_at = ? WHERE id = ?",
        (format_iso(now_china()), kb_id),
    )
    logger.info("文档已删除 kb=%s doc=%s", kb_id, doc_id)
