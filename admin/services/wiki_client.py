import logging
from typing import Any

import httpx
from fastapi import HTTPException, status

from models.wiki import (
    WikiDocumentGraphResponse,
    WikiGraphByDocRequest,
    WikiGraphEdge,
    WikiGraphNode,
    WikiNodeDetailRequest,
    WikiNodeDetailResponse,
    WikiNodeItem,
)
from services.knowledge_client import _knowledge_headers, _raise_upstream_error, _resolve_base_url, _unwrap_data

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_SECONDS = 120.0


def _parse_graph(data: dict[str, Any]) -> WikiDocumentGraphResponse:
    return WikiDocumentGraphResponse(
        doc_id=str(data.get("doc_id") or ""),
        node_count=int(data.get("node_count") or 0),
        edge_count=int(data.get("edge_count") or 0),
        nodes=[WikiGraphNode(**n) for n in (data.get("nodes") or [])],
        edges=[WikiGraphEdge(**e) for e in (data.get("edges") or [])],
        took_ms=int(data.get("took_ms") or 0),
    )


def _parse_node_detail(data: dict[str, Any]) -> WikiNodeDetailResponse:
    node_raw = data.get("node") or {}
    return WikiNodeDetailResponse(
        node=WikiNodeItem(**node_raw),
        took_ms=int(data.get("took_ms") or 0),
    )


async def graph_by_doc(knowledge_key: str, body: WikiGraphByDocRequest) -> WikiDocumentGraphResponse:
    root = await _resolve_base_url()
    payload: dict[str, Any] = {
        "doc_id": body.doc_id,
        "knowledge_key": knowledge_key,
        "max_nodes": body.max_nodes,
    }
    if body.knowledge_ids:
        payload["knowledge_ids"] = body.knowledge_ids

    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.post(
            f"{root}/wiki/graph/by_doc",
            json=payload,
            headers=_knowledge_headers(knowledge_key),
        )
    if resp.status_code >= 400:
        _raise_upstream_error(resp)
    raw = resp.json()
    if isinstance(raw, dict) and "data" in raw and isinstance(raw["data"], dict):
        raw = raw["data"]
    return _parse_graph(raw if isinstance(raw, dict) else {})


async def node_detail(knowledge_key: str, body: WikiNodeDetailRequest) -> WikiNodeDetailResponse:
    root = await _resolve_base_url()
    payload: dict[str, Any] = {
        "node_id": body.node_id,
        "knowledge_key": knowledge_key,
    }
    if body.knowledge_ids:
        payload["knowledge_ids"] = body.knowledge_ids

    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.post(
            f"{root}/wiki/nodes/detail",
            json=payload,
            headers=_knowledge_headers(knowledge_key),
        )
    if resp.status_code >= 400:
        _raise_upstream_error(resp)
    raw = resp.json()
    if isinstance(raw, dict) and "data" in raw and isinstance(raw["data"], dict):
        raw = raw["data"]
    if not isinstance(raw, dict) or not raw.get("node"):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Wiki 节点详情响应无效")
    return _parse_node_detail(raw)
