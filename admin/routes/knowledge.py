import logging
from typing import Annotated

from fastapi import APIRouter, File, Header, Query, UploadFile, status
from fastapi.responses import FileResponse, Response

from constants.knowledge import KNOWLEDGE_KEY_HEADER, SCENE_UID_HEADER
from models.knowledge import (
    KnowledgeBase,
    KnowledgeBaseCreate,
    KnowledgeBaseList,
    KnowledgeBaseUpdate,
    KnowledgeDocument,
    KnowledgeDocumentList,
    KnowledgeEnvironmentList,
    KnowledgeKeyResponse,
    KnowledgeServiceConfig,
)
from routes.knowledge_deps import require_knowledge_key, require_scene_uid
from services import knowledge_client, knowledge_config_store, mongo_client
from services.knowledge_store import delete_base as local_delete_base
from services.knowledge_store import delete_document as local_delete_document
from services.knowledge_store import document_file_path, get_base as local_get_base
from services.knowledge_store import get_document as local_get_document
from services.knowledge_store import create_base as local_create_base
from services.knowledge_store import list_bases as local_list_bases
from services.knowledge_store import list_documents as local_list_documents
from services.knowledge_store import update_base as local_update_base
from services.knowledge_store import upload_document as local_upload_document

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config/knowledge", tags=["knowledge"])


@router.get("/service", response_model=KnowledgeServiceConfig)
async def api_get_service_config() -> KnowledgeServiceConfig:
    return await knowledge_config_store.get_service_config()


@router.put("/service", response_model=KnowledgeServiceConfig)
async def api_save_service_config(body: KnowledgeServiceConfig) -> KnowledgeServiceConfig:
    return await knowledge_config_store.save_service_config(body)


@router.get("/service/environments", response_model=KnowledgeEnvironmentList)
async def api_list_knowledge_environments() -> KnowledgeEnvironmentList:
    return knowledge_config_store.list_environment_options()


@router.post("/service/key", response_model=KnowledgeKeyResponse)
async def api_fetch_knowledge_key(
    x_scene_uid: Annotated[str | None, Header(alias=SCENE_UID_HEADER)] = None,
) -> KnowledgeKeyResponse:
    if not await knowledge_config_store.is_remote_mode():
        from fastapi import HTTPException
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="本地模式无需 knowledge_key")
    return await knowledge_client.fetch_knowledge_key(require_scene_uid(x_scene_uid))


@router.get("/bases", response_model=KnowledgeBaseList)
async def api_list_bases(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
) -> KnowledgeBaseList:
    if await knowledge_config_store.is_remote_mode():
        return await knowledge_client.list_bases(require_knowledge_key(x_knowledge_key), page, page_size)
    return await local_list_bases(mongo_client.get_db(), page, page_size)


@router.post("/bases", response_model=KnowledgeBase, status_code=status.HTTP_201_CREATED)
async def api_create_base(
    body: KnowledgeBaseCreate,
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
) -> KnowledgeBase:
    if await knowledge_config_store.is_remote_mode():
        return await knowledge_client.create_base(require_knowledge_key(x_knowledge_key), body)
    return await local_create_base(mongo_client.get_db(), body)


@router.get("/bases/{kb_id}", response_model=KnowledgeBase)
async def api_get_base(
    kb_id: str,
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
) -> KnowledgeBase:
    if await knowledge_config_store.is_remote_mode():
        return await knowledge_client.get_base(require_knowledge_key(x_knowledge_key), kb_id)
    return await local_get_base(mongo_client.get_db(), kb_id)


@router.put("/bases/{kb_id}", response_model=KnowledgeBase)
async def api_update_base(
    kb_id: str,
    body: KnowledgeBaseUpdate,
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
) -> KnowledgeBase:
    if await knowledge_config_store.is_remote_mode():
        return await knowledge_client.update_base(require_knowledge_key(x_knowledge_key), kb_id, body)
    return await local_update_base(mongo_client.get_db(), kb_id, body)


@router.delete("/bases/{kb_id}", status_code=status.HTTP_204_NO_CONTENT)
async def api_delete_base(
    kb_id: str,
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
) -> None:
    if await knowledge_config_store.is_remote_mode():
        await knowledge_client.delete_base(require_knowledge_key(x_knowledge_key), kb_id)
        return
    await local_delete_base(mongo_client.get_db(), kb_id)


@router.get("/bases/{kb_id}/documents", response_model=KnowledgeDocumentList)
async def api_list_documents(
    kb_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
) -> KnowledgeDocumentList:
    if await knowledge_config_store.is_remote_mode():
        return await knowledge_client.list_documents(
            require_knowledge_key(x_knowledge_key), kb_id, page, page_size,
        )
    return await local_list_documents(mongo_client.get_db(), kb_id, page, page_size)


@router.post("/bases/{kb_id}/documents", response_model=KnowledgeDocument, status_code=status.HTTP_201_CREATED)
async def api_upload_document(
    kb_id: str,
    file: UploadFile = File(...),
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
) -> KnowledgeDocument:
    if await knowledge_config_store.is_remote_mode():
        return await knowledge_client.upload_document(require_knowledge_key(x_knowledge_key), kb_id, file)
    return await local_upload_document(mongo_client.get_db(), kb_id, file)


@router.get("/bases/{kb_id}/documents/{doc_id}", response_model=KnowledgeDocument)
async def api_get_document(
    kb_id: str,
    doc_id: str,
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
) -> KnowledgeDocument:
    if await knowledge_config_store.is_remote_mode():
        return await knowledge_client.get_document(require_knowledge_key(x_knowledge_key), kb_id, doc_id)
    return await local_get_document(mongo_client.get_db(), kb_id, doc_id)


@router.get("/bases/{kb_id}/documents/{doc_id}/download", response_model=None)
async def api_download_document(
    kb_id: str,
    doc_id: str,
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
):
    if await knowledge_config_store.is_remote_mode():
        return await knowledge_client.download_document(require_knowledge_key(x_knowledge_key), kb_id, doc_id)

    doc = await local_get_document(mongo_client.get_db(), kb_id, doc_id)
    path = document_file_path(kb_id, doc_id, doc.name)
    if not path.is_file():
        from fastapi import HTTPException
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    return FileResponse(path, filename=doc.name)


@router.delete("/bases/{kb_id}/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def api_delete_document(
    kb_id: str,
    doc_id: str,
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
) -> None:
    if await knowledge_config_store.is_remote_mode():
        await knowledge_client.delete_document(require_knowledge_key(x_knowledge_key), kb_id, doc_id)
        return
    await local_delete_document(mongo_client.get_db(), kb_id, doc_id)
