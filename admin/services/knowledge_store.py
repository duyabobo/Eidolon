import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from config import settings
from models.knowledge import (
    ChunkingConfig,
    KnowledgeBase,
    KnowledgeBaseCreate,
    KnowledgeBaseList,
    KnowledgeBaseUpdate,
    KnowledgeDocument,
    KnowledgeDocumentList,
)

logger = logging.getLogger(__name__)

KB_COL = "knowledge_bases"
DOC_COL = "knowledge_documents"

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".csv", ".xlsx", ".pptx"}
MAX_FILE_BYTES = 10 * 1024 * 1024


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _knowledge_root() -> Path:
    root = Path(settings.sandbox_root) / "global" / "knowledge"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _doc_dir(kb_id: str, doc_id: str) -> Path:
    return _knowledge_root() / kb_id / doc_id


def _raw_to_kb(raw: dict, doc_count: int = 0) -> KnowledgeBase:
    cfg = raw.get("chunking_config")
    return KnowledgeBase(
        id=str(raw["_id"]),
        name=raw["name"],
        description=raw.get("description", ""),
        type=raw.get("type", "document"),
        document_count=doc_count,
        chunking_config=ChunkingConfig(**cfg) if cfg else None,
        created_at=raw["created_at"],
        updated_at=raw["updated_at"],
    )


def _raw_to_doc(raw: dict) -> KnowledgeDocument:
    return KnowledgeDocument(
        id=str(raw["_id"]),
        kb_id=raw["kb_id"],
        name=raw["name"],
        file_size=int(raw.get("file_size", 0)),
        status=raw.get("status", "uploaded"),
        error_message=raw.get("error_message"),
        created_at=raw["created_at"],
        updated_at=raw["updated_at"],
    )


async def _count_docs(db: AsyncIOMotorDatabase, kb_id: str) -> int:
    return await db[DOC_COL].count_documents({"kb_id": kb_id})


async def list_bases(db: AsyncIOMotorDatabase, page: int, page_size: int) -> KnowledgeBaseList:
    skip = (page - 1) * page_size
    total = await db[KB_COL].count_documents({})
    cursor = db[KB_COL].find({}).sort("updated_at", -1).skip(skip).limit(page_size)
    items: list[KnowledgeBase] = []
    async for raw in cursor:
        doc_count = await _count_docs(db, str(raw["_id"]))
        items.append(_raw_to_kb(raw, doc_count))
    return KnowledgeBaseList(items=items, total=total, page=page, page_size=page_size)


async def get_base(db: AsyncIOMotorDatabase, kb_id: str) -> KnowledgeBase:
    raw = await db[KB_COL].find_one({"_id": kb_id})
    if not raw:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="知识库不存在")
    doc_count = await _count_docs(db, kb_id)
    return _raw_to_kb(raw, doc_count)


async def create_base(db: AsyncIOMotorDatabase, body: KnowledgeBaseCreate) -> KnowledgeBase:
    now = _now()
    kb_id = str(uuid.uuid4())
    doc = {
        "_id": kb_id,
        "name": body.name.strip(),
        "description": body.description.strip(),
        "type": body.type,
        "chunking_config": body.chunking_config.model_dump() if body.chunking_config else None,
        "created_at": now,
        "updated_at": now,
    }
    await db[KB_COL].insert_one(doc)
    (_knowledge_root() / kb_id).mkdir(parents=True, exist_ok=True)
    logger.info("知识库已创建 id=%s name=%s", kb_id, body.name)
    return _raw_to_kb(doc, 0)


async def update_base(db: AsyncIOMotorDatabase, kb_id: str, body: KnowledgeBaseUpdate) -> KnowledgeBase:
    raw = await db[KB_COL].find_one({"_id": kb_id})
    if not raw:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="知识库不存在")

    patch: dict = {"updated_at": _now()}
    if body.name is not None:
        patch["name"] = body.name.strip()
    if body.description is not None:
        patch["description"] = body.description.strip()
    if body.chunking_config is not None:
        patch["chunking_config"] = body.chunking_config.model_dump()

    await db[KB_COL].update_one({"_id": kb_id}, {"$set": patch})
    return await get_base(db, kb_id)


async def delete_base(db: AsyncIOMotorDatabase, kb_id: str) -> None:
    raw = await db[KB_COL].find_one({"_id": kb_id})
    if not raw:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="知识库不存在")

    await db[DOC_COL].delete_many({"kb_id": kb_id})
    await db[KB_COL].delete_one({"_id": kb_id})
    shutil.rmtree(_knowledge_root() / kb_id, ignore_errors=True)
    logger.info("知识库已删除 id=%s", kb_id)


async def list_documents(
    db: AsyncIOMotorDatabase, kb_id: str, page: int, page_size: int,
) -> KnowledgeDocumentList:
    await get_base(db, kb_id)
    skip = (page - 1) * page_size
    total = await db[DOC_COL].count_documents({"kb_id": kb_id})
    cursor = db[DOC_COL].find({"kb_id": kb_id}).sort("created_at", -1).skip(skip).limit(page_size)
    items = [_raw_to_doc(raw) async for raw in cursor]
    return KnowledgeDocumentList(items=items, total=total, page=page, page_size=page_size)


async def get_document(db: AsyncIOMotorDatabase, kb_id: str, doc_id: str) -> KnowledgeDocument:
    raw = await db[DOC_COL].find_one({"_id": doc_id, "kb_id": kb_id})
    if not raw:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    return _raw_to_doc(raw)


def document_file_path(kb_id: str, doc_id: str, filename: str) -> Path:
    return _doc_dir(kb_id, doc_id) / filename


async def upload_document(
    db: AsyncIOMotorDatabase, kb_id: str, upload: UploadFile,
) -> KnowledgeDocument:
    await get_base(db, kb_id)

    filename = (upload.filename or "unnamed").strip()
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的文件类型 {suffix}，允许: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    content = await upload.read()
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件不能超过 10MB")

    now = _now()
    doc_id = str(uuid.uuid4())
    target_dir = _doc_dir(kb_id, doc_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    file_path = target_dir / filename
    file_path.write_bytes(content)

    raw = {
        "_id": doc_id,
        "kb_id": kb_id,
        "name": filename,
        "file_size": len(content),
        "status": "uploaded",
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    await db[DOC_COL].insert_one(raw)
    await db[KB_COL].update_one({"_id": kb_id}, {"$set": {"updated_at": now}})
    logger.info("文档已上传 kb=%s doc=%s file=%s size=%d", kb_id, doc_id, filename, len(content))
    return _raw_to_doc(raw)


async def delete_document(db: AsyncIOMotorDatabase, kb_id: str, doc_id: str) -> None:
    raw = await db[DOC_COL].find_one({"_id": doc_id, "kb_id": kb_id})
    if not raw:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")

    await db[DOC_COL].delete_one({"_id": doc_id})
    shutil.rmtree(_doc_dir(kb_id, doc_id), ignore_errors=True)
    await db[KB_COL].update_one({"_id": kb_id}, {"$set": {"updated_at": _now()}})
    logger.info("文档已删除 kb=%s doc=%s", kb_id, doc_id)
