import logging

from fastapi import APIRouter, File, Query, UploadFile, status
from fastapi.responses import FileResponse

from cm_server.admin.models.knowledge import (
    KnowledgeBase,
    KnowledgeBaseCreate,
    KnowledgeBaseList,
    KnowledgeBaseUpdate,
    KnowledgeDocument,
    KnowledgeDocumentList,
    KnowledgePipelineConfig,
    ServiceTestResult,
)
from cm_server.admin.services import knowledge_pipeline_store
from cm_server.admin.services.pipeline_probe import probe_mineru
from cm_server.admin.services.knowledge_store import create_base as local_create_base
from cm_server.admin.services.knowledge_store import delete_base as local_delete_base
from cm_server.admin.services.knowledge_store import delete_document as local_delete_document
from cm_server.admin.services.knowledge_store import document_file_path
from cm_server.admin.services.knowledge_store import get_base as local_get_base
from cm_server.admin.services.knowledge_store import get_document as local_get_document
from cm_server.admin.services.knowledge_store import list_bases as local_list_bases
from cm_server.admin.services.knowledge_store import list_documents as local_list_documents
from cm_server.admin.services.knowledge_store import update_base as local_update_base
from cm_server.admin.services.knowledge_store import upload_document as local_upload_document

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config/knowledge", tags=["knowledge"])


@router.get("/service", response_model=KnowledgePipelineConfig)
async def api_get_pipeline_config() -> KnowledgePipelineConfig:
    return await knowledge_pipeline_store.get_pipeline_config()


@router.put("/service", response_model=KnowledgePipelineConfig)
async def api_save_pipeline_config(body: KnowledgePipelineConfig) -> KnowledgePipelineConfig:
    return await knowledge_pipeline_store.save_pipeline_config(body)


@router.post("/service/test-mineru", response_model=ServiceTestResult)
async def api_test_mineru(body: KnowledgePipelineConfig) -> ServiceTestResult:
    return await probe_mineru(body)


@router.get("/bases", response_model=KnowledgeBaseList)
async def api_list_bases(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> KnowledgeBaseList:
    return await local_list_bases(page, page_size, exclude_hidden=True)


@router.post("/bases", response_model=KnowledgeBase, status_code=status.HTTP_201_CREATED)
async def api_create_base(body: KnowledgeBaseCreate) -> KnowledgeBase:
    return await local_create_base(body)


@router.get("/bases/{kb_id}", response_model=KnowledgeBase)
async def api_get_base(kb_id: str) -> KnowledgeBase:
    return await local_get_base(kb_id)


@router.put("/bases/{kb_id}", response_model=KnowledgeBase)
async def api_update_base(kb_id: str, body: KnowledgeBaseUpdate) -> KnowledgeBase:
    return await local_update_base(kb_id, body)


@router.delete("/bases/{kb_id}", status_code=status.HTTP_204_NO_CONTENT)
async def api_delete_base(kb_id: str) -> None:
    await local_delete_base(kb_id)


@router.get("/bases/{kb_id}/documents", response_model=KnowledgeDocumentList)
async def api_list_documents(
    kb_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> KnowledgeDocumentList:
    return await local_list_documents(kb_id, page, page_size)


@router.post(
    "/bases/{kb_id}/documents",
    response_model=KnowledgeDocument,
    status_code=status.HTTP_201_CREATED,
)
async def api_upload_document(
    kb_id: str,
    file: UploadFile = File(...),
) -> KnowledgeDocument:
    return await local_upload_document(kb_id, file, process=True)


@router.get("/bases/{kb_id}/documents/{doc_id}", response_model=KnowledgeDocument)
async def api_get_document(kb_id: str, doc_id: str) -> KnowledgeDocument:
    return await local_get_document(kb_id, doc_id)


@router.get("/bases/{kb_id}/documents/{doc_id}/download")
async def api_download_document(kb_id: str, doc_id: str) -> FileResponse:
    doc = await local_get_document(kb_id, doc_id)
    path = document_file_path(kb_id, doc_id, doc.name)
    return FileResponse(path, filename=doc.name)


@router.delete(
    "/bases/{kb_id}/documents/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def api_delete_document(kb_id: str, doc_id: str) -> None:
    await local_delete_document(kb_id, doc_id)
