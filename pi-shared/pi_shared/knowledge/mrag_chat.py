"""
mRAG 外部服务：对话附件入库（admin / gateway 共用，不经彼此转发）。

调用方传入 base_url（从 Mongo knowledge_service_configs 或环境解析）。
本地模式（无 base_url）请走 admin 本地 knowledge_store，不走本模块。
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from pi_shared.knowledge_constants import (
    CHAT_UPLOAD_KB_DESCRIPTION,
    CHAT_UPLOAD_KB_NAME,
    DEFAULT_DATASET_AVATAR,
    KNOWLEDGE_BATCH_PROCESS_TYPE,
    KNOWLEDGE_SCENE_TYPE,
)
from pi_shared.trace_context import merge_trace_headers
from pi_shared.workspace.chat_document import KnowledgeUploadResult

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(120.0, connect=10.0)
_DATASET_LIST_LIMIT = 100


class MragError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def normalize_mrag_base_url(url: str) -> str:
    trimmed = (url or "").strip()
    if not trimmed:
        return ""
    if "://" not in trimmed:
        return f"http://{trimmed}"
    return trimmed.rstrip("/")


async def load_mrag_base_url(db: Any) -> str:
    """从本地 SQLite 的 knowledge_service_configs 表读取当前 mRAG 地址；空表示本地模式。"""
    raw = await db.fetch_one(
        "SELECT base_url FROM knowledge_service_configs ORDER BY created_at DESC LIMIT 1"
    )
    if not raw:
        return ""
    return normalize_mrag_base_url(str(raw.get("base_url") or ""))


def _unwrap_data(resp: httpx.Response) -> Any:
    if resp.status_code >= 400:
        detail = resp.text
        try:
            payload = resp.json()
            if isinstance(payload, dict):
                detail = str(payload.get("detail") or payload.get("message") or detail)
        except Exception:
            pass
        raise MragError(detail or "mRAG 请求失败", status_code=resp.status_code)
    payload = resp.json()
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


async def _request_json(method: str, url: str, **kwargs: Any) -> Any:
    kwargs["headers"] = merge_trace_headers(kwargs.get("headers"))
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.request(method, url, **kwargs)
    except httpx.RequestError as exc:
        raise MragError(f"无法连接 mRAG: {exc}", status_code=502) from exc
    return _unwrap_data(resp)


def _knowledge_headers(knowledge_key: str) -> dict[str, str]:
    return {"x-knowledge-key": knowledge_key}


async def fetch_knowledge_key(base_url: str, scene_uid: str) -> str:
    root = normalize_mrag_base_url(base_url)
    if not root:
        raise MragError("未配置 mRAG 服务地址", status_code=503)
    uid = scene_uid.strip()
    if not uid:
        raise MragError("scene_uid 不能为空", status_code=400)
    data = await _request_json(
        "POST",
        f"{root}/dataset/get_or_create_knowledge_key",
        json={"scene_uid": uid, "scene_type": KNOWLEDGE_SCENE_TYPE},
    )
    knowledge_key = str((data or {}).get("knowledge_key") or "")
    if not knowledge_key:
        raise MragError("mRAG 未返回 knowledge_key", status_code=502)
    logger.info("mRAG knowledge_key 已获取 scene_uid=%s", uid)
    return knowledge_key


async def _ensure_chat_kb(base_url: str, knowledge_key: str) -> str:
    root = normalize_mrag_base_url(base_url)
    data = await _request_json(
        "GET",
        f"{root}/dataset/list",
        params={"limit": _DATASET_LIST_LIMIT},
        headers=_knowledge_headers(knowledge_key),
    )
    items = (data or {}).get("list") or []
    for item in items:
        if str(item.get("name") or "") == CHAT_UPLOAD_KB_NAME:
            kb_id = str(item.get("_id") or item.get("id") or "")
            if kb_id:
                return kb_id
    created = await _request_json(
        "POST",
        f"{root}/dataset/create",
        json={
            "name": CHAT_UPLOAD_KB_NAME,
            "intro": CHAT_UPLOAD_KB_DESCRIPTION,
            "avatar": DEFAULT_DATASET_AVATAR,
        },
        headers=_knowledge_headers(knowledge_key),
    )
    # mRAG create 返回 data 即为 dataset_id 字符串
    kb_id = str(created or "").strip()
    if not kb_id:
        raise MragError("创建会话附件知识库失败", status_code=502)
    logger.info("已创建 mRAG 会话附件库 kb_id=%s", kb_id)
    return kb_id


async def _batch_process(base_url: str, knowledge_key: str, doc_ids: list[str]) -> None:
    if not doc_ids:
        return
    root = normalize_mrag_base_url(base_url)
    await _request_json(
        "POST",
        f"{root}/documents/batch_process",
        json={
            "doc_ids": doc_ids,
            "process_type": KNOWLEDGE_BATCH_PROCESS_TYPE,
            "wait_for_completion": False,
        },
        headers=_knowledge_headers(knowledge_key),
    )


async def upload_chat_attachment_to_mrag(
    *,
    base_url: str,
    scene_uid: str,
    filename: str,
    content: bytes,
    content_type: str | None = None,
) -> KnowledgeUploadResult:
    """对话附件 → mRAG：拿 key → 确保「会话附件」库 → batch_upload → batch_process。"""
    root = normalize_mrag_base_url(base_url)
    if not root:
        raise MragError("未配置 mRAG 服务地址（本地模式请走 admin 本地入库）", status_code=503)

    knowledge_key = await fetch_knowledge_key(root, scene_uid)
    kb_id = await _ensure_chat_kb(root, knowledge_key)

    files = {"files": (filename, content, content_type or "application/octet-stream")}
    data = {"knowledge_id": kb_id}
    headers = merge_trace_headers(_knowledge_headers(knowledge_key))
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{root}/documents/batch_upload",
                data=data,
                files=files,
                headers=headers,
            )
    except httpx.RequestError as exc:
        raise MragError(f"无法连接 mRAG: {exc}", status_code=502) from exc

    upload_data = _unwrap_data(resp) or {}
    results = upload_data.get("results") or []
    if not results:
        raise MragError("文档上传失败", status_code=502)
    doc_id = str(results[0].get("doc_id") or "")
    if not doc_id:
        raise MragError("文档上传未返回 doc_id", status_code=502)

    await _batch_process(root, knowledge_key, [doc_id])
    logger.info(
        "mRAG 对话附件已入库 scene_uid=%s kb_id=%s doc_id=%s file=%s",
        scene_uid, kb_id, doc_id, filename,
    )
    return KnowledgeUploadResult(
        doc_id=doc_id,
        kb_id=kb_id,
        knowledge_key=knowledge_key,
        status="processing",
    )
