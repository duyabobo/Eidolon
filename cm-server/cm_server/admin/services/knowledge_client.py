import logging
from datetime import datetime
from typing import Any

import httpx
from fastapi import HTTPException, UploadFile, status
from fastapi.responses import Response

from cm_server.admin.constants.knowledge import (
    DEFAULT_DATASET_AVATAR,
    KNOWLEDGE_BATCH_PROCESS_TYPE,
    KNOWLEDGE_SCENE_TYPE,
    is_chat_upload_kb,
)
from cm_server.admin.models.knowledge import (
    KnowledgeBase,
    KnowledgeBaseCreate,
    KnowledgeBaseList,
    KnowledgeBaseUpdate,
    KnowledgeDocument,
    KnowledgeDocumentList,
    KnowledgeKeyResponse,
)
from pi_shared import format_iso, merge_trace_headers, now_china, to_china
from cm_server.admin.services.knowledge_config_store import get_service_config, normalize_base_url

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_SECONDS = 120.0
# mRAG dataset/list 无 offset，单次尽量拉全（默认上限 100）
_DATASET_LIST_LIMIT = 100

_DOC_STATUS_MAP = {
    "init": "uploaded",
    "pending": "processing",
    "processing": "processing",
    "preprocessed": "processing",
    "processed": "indexed",
    "failed": "failed",
}


def _api_root(base_url: str) -> str:
    return base_url.rstrip("/")


async def _resolve_base_url() -> str:
    cfg = await get_service_config()
    base_url = normalize_base_url(cfg.base_url)
    if not base_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="未配置知识库服务地址")
    return _api_root(base_url)


async def _request_json(method: str, url: str, **kwargs: Any) -> httpx.Response:
    kwargs["headers"] = merge_trace_headers(kwargs.get("headers"))
    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            return await client.request(method, url, **kwargs)
    except httpx.UnsupportedProtocol as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="知识库服务地址无效，需以 http:// 或 https:// 开头",
        ) from exc
    except httpx.RequestError as exc:
        logger.warning("知识库服务连接失败 url=%s err=%s", url, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"无法连接知识库服务: {exc}",
        ) from exc


def _raise_upstream_error(resp: httpx.Response) -> None:
    detail = resp.text
    try:
        payload = resp.json()
        if isinstance(payload, dict):
            if payload.get("detail"):
                detail = str(payload["detail"])
            elif payload.get("message"):
                detail = str(payload["message"])
    except Exception:
        pass
    logger.warning("知识库服务请求失败 status=%d detail=%s", resp.status_code, detail[:200])
    raise HTTPException(status_code=resp.status_code, detail=detail or "知识库服务请求失败")


def _unwrap_data(resp: httpx.Response) -> Any:
    if resp.status_code >= 400:
        _raise_upstream_error(resp)
    payload = resp.json()
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _paginated_payload(data: Any) -> tuple[list[Any], int]:
    """兼容 mRAG 分页字段：documents/list + total_count/total。"""
    if not isinstance(data, dict):
        return [], 0
    items = data.get("documents")
    if items is None:
        items = data.get("list")
    if not isinstance(items, list):
        items = []
    total_raw = data.get("total_count")
    if total_raw is None:
        total_raw = data.get("total")
    total = int(total_raw) if total_raw is not None else len(items)
    return items, total


def _parse_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        return to_china(value)
    if isinstance(value, str) and value.strip():
        text = value.strip().replace(" ", "T")
        try:
            parsed = datetime.fromisoformat(text)
            return to_china(parsed) if parsed.tzinfo else parsed
        except ValueError:
            pass
    return now_china()


def _map_dataset(raw: dict) -> KnowledgeBase:
    return KnowledgeBase(
        id=str(raw.get("_id") or raw.get("id") or ""),
        name=str(raw.get("name") or ""),
        description=str(raw.get("intro") or raw.get("description") or ""),
        type="document",
        document_count=int(raw.get("unit_count") or raw.get("document_count") or 0),
        chunking_config=None,
        created_at=_parse_dt(raw.get("createTime") or raw.get("created_at")),
        updated_at=_parse_dt(raw.get("updateTime") or raw.get("updated_at")),
    )


def _map_document(kb_id: str, raw: dict) -> KnowledgeDocument:
    status_raw = str(raw.get("status") or "uploaded").lower()
    mapped_status = _DOC_STATUS_MAP.get(status_raw, "uploaded")
    file_size_raw = raw.get("file_size") or "0"
    if isinstance(file_size_raw, str):
        digits = "".join(ch for ch in file_size_raw if ch.isdigit() or ch == ".")
        try:
            file_size = int(float(digits) * 1024) if "kb" in file_size_raw.lower() else int(float(digits or 0))
        except ValueError:
            file_size = 0
    else:
        file_size = int(file_size_raw)

    now = now_china()
    created = _parse_dt(raw.get("created_at")) if raw.get("created_at") else now
    updated = _parse_dt(raw.get("updated_at")) if raw.get("updated_at") else created
    return KnowledgeDocument(
        id=str(raw.get("doc_id") or raw.get("id") or ""),
        kb_id=kb_id,
        name=str(raw.get("file_name") or raw.get("name") or ""),
        file_size=file_size,
        status=mapped_status,  # type: ignore[arg-type]
        error_message=raw.get("error_message"),
        created_at=created,
        updated_at=updated,
    )


async def fetch_knowledge_key(scene_uid: str) -> KnowledgeKeyResponse:
    """按当前服务配置与用户 scene_uid 调用 mRAG get_or_create_knowledge_key。"""
    uid = scene_uid.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="scene_uid 不能为空")
    root = await _resolve_base_url()
    payload = {
        "scene_uid": uid,
        "scene_type": KNOWLEDGE_SCENE_TYPE,
    }
    resp = await _request_json(
        "POST",
        f"{root}/dataset/get_or_create_knowledge_key",
        json=payload,
    )
    data = _unwrap_data(resp)
    knowledge_key = str((data or {}).get("knowledge_key") or "")
    if not knowledge_key:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="知识库服务未返回 knowledge_key")
    logger.info("已获取 knowledge_key scene_uid=%s scene_type=%s", uid, KNOWLEDGE_SCENE_TYPE)
    return KnowledgeKeyResponse(knowledge_key=knowledge_key)


def _knowledge_headers(knowledge_key: str) -> dict[str, str]:
    return {"x-knowledge-key": knowledge_key}


async def _batch_process_documents(knowledge_key: str, doc_ids: list[str]) -> None:
    if not doc_ids:
        return
    root = await _resolve_base_url()
    payload = {
        "doc_ids": doc_ids,
        "process_type": KNOWLEDGE_BATCH_PROCESS_TYPE,
        "wait_for_completion": False,
    }
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.post(
            f"{root}/documents/batch_process",
            json=payload,
            headers=merge_trace_headers(_knowledge_headers(knowledge_key)),
        )
    _unwrap_data(resp)
    logger.info(
        "batch_process 已提交 doc_count=%d process_type=%d scene_type=%s",
        len(doc_ids),
        KNOWLEDGE_BATCH_PROCESS_TYPE,
        KNOWLEDGE_SCENE_TYPE,
    )


async def list_bases(
    knowledge_key: str,
    page: int,
    page_size: int,
    *,
    exclude_hidden: bool = False,
) -> KnowledgeBaseList:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.get(
            f"{root}/dataset/list",
            params={"limit": _DATASET_LIST_LIMIT},
            headers=merge_trace_headers(_knowledge_headers(knowledge_key)),
        )
    data = _unwrap_data(resp) or {}
    all_items = [_map_dataset(item) for item in data.get("list", [])]
    reported_total = int(data.get("total") or len(all_items))
    if reported_total > len(all_items):
        logger.warning(
            "知识库列表未完全返回 total=%d fetched=%d limit=%d",
            reported_total, len(all_items), _DATASET_LIST_LIMIT,
        )
    if exclude_hidden:
        all_items = [item for item in all_items if not is_chat_upload_kb(item.name)]
        total = len(all_items)
    else:
        total = reported_total
    start = (page - 1) * page_size
    end = start + page_size
    return KnowledgeBaseList(
        items=all_items[start:end],
        total=total,
        page=page,
        page_size=page_size,
    )


async def create_base(knowledge_key: str, body: KnowledgeBaseCreate) -> KnowledgeBase:
    root = await _resolve_base_url()
    payload = {
        "name": body.name,
        "intro": body.description,
        "avatar": DEFAULT_DATASET_AVATAR,
    }
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.post(
            f"{root}/dataset/create",
            json=payload,
            headers=merge_trace_headers(_knowledge_headers(knowledge_key)),
        )
    dataset_id = _unwrap_data(resp)
    return KnowledgeBase(
        id=str(dataset_id),
        name=body.name,
        description=body.description,
        type=body.type,
        document_count=0,
        chunking_config=body.chunking_config,
        created_at=now_china(),
        updated_at=now_china(),
    )


async def get_base(knowledge_key: str, kb_id: str) -> KnowledgeBase:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.get(
            f"{root}/dataset/list",
            params={"dataset_id": kb_id, "limit": 1},
            headers=merge_trace_headers(_knowledge_headers(knowledge_key)),
        )
    data = _unwrap_data(resp) or {}
    items = data.get("list") or []
    if not items:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="知识库不存在")
    return _map_dataset(items[0])


async def update_base(knowledge_key: str, kb_id: str, body: KnowledgeBaseUpdate) -> KnowledgeBase:
    current = await get_base(knowledge_key, kb_id)
    payload: dict[str, Any] = {"id": kb_id}

    if body.name is not None:
        new_name = body.name.strip()
        if new_name != current.name.strip():
            payload["name"] = new_name

    if body.description is not None:
        new_intro = body.description.strip()
        if new_intro != (current.description or "").strip():
            payload["intro"] = new_intro

    if len(payload) == 1:
        logger.info("知识库无变更，跳过 edit: id=%s", kb_id)
        return current

    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.post(
            f"{root}/dataset/edit",
            json=payload,
            headers=merge_trace_headers(_knowledge_headers(knowledge_key)),
        )
    try:
        raw = _unwrap_data(resp) or {}
    except HTTPException as exc:
        detail = str(exc.detail or "")
        if "already exists" in detail.lower():
            raise HTTPException(
                status_code=exc.status_code,
                detail=(
                    f"{detail}。"
                    "若列表中未见同名项，可能是 mRAG 按用户全局校验重名，"
                    "或列表未展示全部知识库，请尝试其他名称。"
                ),
            ) from exc
        raise
    return _map_dataset(raw)


async def delete_base(knowledge_key: str, kb_id: str) -> None:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.post(
            f"{root}/dataset/delete",
            json={"id": kb_id},
            headers=merge_trace_headers(_knowledge_headers(knowledge_key)),
        )
    _unwrap_data(resp)


async def list_documents(knowledge_key: str, kb_id: str, page: int, page_size: int) -> KnowledgeDocumentList:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.get(
            f"{root}/documents/by_knowledge/{kb_id}",
            params={"page_no": page, "page_size": page_size},
            headers=merge_trace_headers(_knowledge_headers(knowledge_key)),
        )
    data = _unwrap_data(resp) or {}
    items_raw, total = _paginated_payload(data)
    items = [_map_document(kb_id, item) for item in items_raw]
    return KnowledgeDocumentList(items=items, total=total, page=page, page_size=page_size)


async def get_document(knowledge_key: str, kb_id: str, doc_id: str) -> KnowledgeDocument:
    page = 1
    page_size = 200
    while True:
        batch = await list_documents(knowledge_key, kb_id, page=page, page_size=page_size)
        for doc in batch.items:
            if doc.id == doc_id:
                return doc
        if page * page_size >= batch.total:
            break
        page += 1
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")


async def upload_document(knowledge_key: str, kb_id: str, upload: UploadFile) -> KnowledgeDocument:
    root = await _resolve_base_url()
    content = await upload.read()
    filename = upload.filename or "unnamed"
    files = {"files": (filename, content, upload.content_type or "application/octet-stream")}
    data = {"knowledge_id": kb_id}

    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.post(
            f"{root}/documents/batch_upload",
            data=data,
            files=files,
            headers=merge_trace_headers(_knowledge_headers(knowledge_key)),
        )
    upload_data = _unwrap_data(resp) or {}
    results = upload_data.get("results") or []
    if not results:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="文档上传失败")

    first = results[0]
    doc_id = str(first.get("doc_id") or "")
    if not doc_id:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="文档上传未返回 doc_id")

    await _batch_process_documents(knowledge_key, [doc_id])
    return _map_document(kb_id, {
        "doc_id": doc_id,
        "file_name": filename,
        "file_size": len(content),
        "status": "pending",
        "created_at": format_iso(now_china()),
        "updated_at": format_iso(now_china()),
    })


async def delete_document(knowledge_key: str, kb_id: str, doc_id: str) -> None:
    root = await _resolve_base_url()
    payload = {
        "doc_ids": [doc_id],
        "delete_file": False,
        "delete_llm_cache": False,
    }
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.request(
            "DELETE",
            f"{root}/documents/delete_document",
            json=payload,
            headers=merge_trace_headers(_knowledge_headers(knowledge_key)),
        )
    _unwrap_data(resp)
    logger.info("文档已删除 kb_id=%s doc_id=%s", kb_id, doc_id)


async def download_document(knowledge_key: str, kb_id: str, doc_id: str) -> Response:
    root = await _resolve_base_url()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.get(
            f"{root}/documents/download/{doc_id}",
            headers=merge_trace_headers(_knowledge_headers(knowledge_key)),
        )
    if resp.status_code >= 400:
        _raise_upstream_error(resp)

    headers: dict[str, str] = {}
    disposition = resp.headers.get("content-disposition")
    if disposition:
        headers["Content-Disposition"] = disposition
    content_type = resp.headers.get("content-type", "application/octet-stream")
    return Response(content=resp.content, media_type=content_type, headers=headers)
