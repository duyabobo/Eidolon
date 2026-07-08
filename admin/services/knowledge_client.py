import logging
from typing import Any

import httpx
from fastapi import HTTPException, UploadFile, status
from fastapi.responses import Response

from models.knowledge import (
    KnowledgeBase,
    KnowledgeBaseCreate,
    KnowledgeBaseList,
    KnowledgeBaseUpdate,
    KnowledgeDocument,
    KnowledgeDocumentList,
)
from services.knowledge_config_store import get_service_config

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_SECONDS = 120.0


def _api_root(base_url: str) -> str:
    return base_url.rstrip("/")


async def _resolve_base_url() -> str:
    cfg = await get_service_config()
    if not cfg.base_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="未配置知识库服务地址")
    return _api_root(cfg.base_url)


def _raise_upstream_error(resp: httpx.Response) -> None:
    detail = resp.text
    try:
        payload = resp.json()
        if isinstance(payload, dict) and payload.get("detail"):
            detail = str(payload["detail"])
    except Exception:
        pass
    logger.warning("知识库服务请求失败 status=%d detail=%s", resp.status_code, detail[:200])
    raise HTTPException(status_code=resp.status_code, detail=detail or "知识库服务请求失败")


async def list_bases(page: int, page_size: int) -> KnowledgeBaseList:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.get(f"{root}/bases", params={"page": page, "page_size": page_size})
    if resp.status_code >= 400:
        _raise_upstream_error(resp)
    return KnowledgeBaseList(**resp.json())


async def create_base(body: KnowledgeBaseCreate) -> KnowledgeBase:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.post(f"{root}/bases", json=body.model_dump())
    if resp.status_code >= 400:
        _raise_upstream_error(resp)
    return KnowledgeBase(**resp.json())


async def get_base(kb_id: str) -> KnowledgeBase:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.get(f"{root}/bases/{kb_id}")
    if resp.status_code >= 400:
        _raise_upstream_error(resp)
    return KnowledgeBase(**resp.json())


async def update_base(kb_id: str, body: KnowledgeBaseUpdate) -> KnowledgeBase:
    root = await _resolve_base_url()
    payload: dict[str, Any] = body.model_dump(exclude_unset=True)
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.put(f"{root}/bases/{kb_id}", json=payload)
    if resp.status_code >= 400:
        _raise_upstream_error(resp)
    return KnowledgeBase(**resp.json())


async def delete_base(kb_id: str) -> None:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.delete(f"{root}/bases/{kb_id}")
    if resp.status_code >= 400:
        _raise_upstream_error(resp)


async def list_documents(kb_id: str, page: int, page_size: int) -> KnowledgeDocumentList:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.get(
            f"{root}/bases/{kb_id}/documents",
            params={"page": page, "page_size": page_size},
        )
    if resp.status_code >= 400:
        _raise_upstream_error(resp)
    return KnowledgeDocumentList(**resp.json())


async def get_document(kb_id: str, doc_id: str) -> KnowledgeDocument:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.get(f"{root}/bases/{kb_id}/documents/{doc_id}")
    if resp.status_code >= 400:
        _raise_upstream_error(resp)
    return KnowledgeDocument(**resp.json())


async def upload_document(kb_id: str, upload: UploadFile) -> KnowledgeDocument:
    root = await _resolve_base_url()
    content = await upload.read()
    filename = upload.filename or "unnamed"
    files = {"file": (filename, content, upload.content_type or "application/octet-stream")}
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.post(f"{root}/bases/{kb_id}/documents", files=files)
    if resp.status_code >= 400:
        _raise_upstream_error(resp)
    return KnowledgeDocument(**resp.json())


async def delete_document(kb_id: str, doc_id: str) -> None:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.delete(f"{root}/bases/{kb_id}/documents/{doc_id}")
    if resp.status_code >= 400:
        _raise_upstream_error(resp)


async def download_document(kb_id: str, doc_id: str) -> Response:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.get(f"{root}/bases/{kb_id}/documents/{doc_id}/download")
    if resp.status_code >= 400:
        _raise_upstream_error(resp)

    headers: dict[str, str] = {}
    disposition = resp.headers.get("content-disposition")
    if disposition:
        headers["Content-Disposition"] = disposition
    content_type = resp.headers.get("content-type", "application/octet-stream")
    return Response(content=resp.content, media_type=content_type, headers=headers)
