import logging

from fastapi import APIRouter, File, Query, UploadFile, status
from fastapi.responses import FileResponse

from models.knowledge import (
    KnowledgeBase,
    KnowledgeBaseCreate,
    KnowledgeBaseList,
    KnowledgeBaseUpdate,
    KnowledgeDocument,
    KnowledgeDocumentList,
)
from services import mongo_client
from services.knowledge_store import delete_base, delete_document, document_file_path, get_base, get_document
from services.knowledge_store import create_base, list_bases, list_documents, update_base, upload_document

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config/knowledge", tags=["knowledge"])


@router.get("/bases", response_model=KnowledgeBaseList)
async def api_list_bases(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> KnowledgeBaseList:
    return await list_bases(mongo_client.get_db(), page, page_size)


@router.post("/bases", response_model=KnowledgeBase, status_code=status.HTTP_201_CREATED)
async def api_create_base(body: KnowledgeBaseCreate) -> KnowledgeBase:
    return await create_base(mongo_client.get_db(), body)


@router.get("/bases/{kb_id}", response_model=KnowledgeBase)
async def api_get_base(kb_id: str) -> KnowledgeBase:
    return await get_base(mongo_client.get_db(), kb_id)


@router.put("/bases/{kb_id}", response_model=KnowledgeBase)
async def api_update_base(kb_id: str, body: KnowledgeBaseUpdate) -> KnowledgeBase:
    return await update_base(mongo_client.get_db(), kb_id, body)


@router.delete("/bases/{kb_id}", status_code=status.HTTP_204_NO_CONTENT)
async def api_delete_base(kb_id: str) -> None:
    await delete_base(mongo_client.get_db(), kb_id)


@router.get("/bases/{kb_id}/documents", response_model=KnowledgeDocumentList)
async def api_list_documents(
    kb_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> KnowledgeDocumentList:
    return await list_documents(mongo_client.get_db(), kb_id, page, page_size)


@router.post("/bases/{kb_id}/documents", response_model=KnowledgeDocument, status_code=status.HTTP_201_CREATED)
async def api_upload_document(kb_id: str, file: UploadFile = File(...)) -> KnowledgeDocument:
    return await upload_document(mongo_client.get_db(), kb_id, file)


@router.get("/bases/{kb_id}/documents/{doc_id}", response_model=KnowledgeDocument)
async def api_get_document(kb_id: str, doc_id: str) -> KnowledgeDocument:
    return await get_document(mongo_client.get_db(), kb_id, doc_id)


@router.get("/bases/{kb_id}/documents/{doc_id}/download")
async def api_download_document(kb_id: str, doc_id: str) -> FileResponse:
    doc = await get_document(mongo_client.get_db(), kb_id, doc_id)
    path = document_file_path(kb_id, doc_id, doc.name)
    if not path.is_file():
        from fastapi import HTTPException
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    return FileResponse(path, filename=doc.name)


@router.delete("/bases/{kb_id}/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def api_delete_document(kb_id: str, doc_id: str) -> None:
    await delete_document(mongo_client.get_db(), kb_id, doc_id)
