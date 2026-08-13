import logging

from fastapi import APIRouter

from cm_server.admin.models.wiki import (
    WikiDocumentGraphResponse,
    WikiGraphByDocRequest,
    WikiNodeDetailRequest,
    WikiNodeDetailResponse,
)
from cm_server.mrag import wiki_local

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config/knowledge/wiki", tags=["knowledge-wiki"])


@router.post("/graph/by_doc", response_model=WikiDocumentGraphResponse)
async def api_wiki_graph_by_doc(body: WikiGraphByDocRequest) -> WikiDocumentGraphResponse:
    return await wiki_local.graph_by_doc(body.doc_id, max_nodes=body.max_nodes)


@router.post("/nodes/detail", response_model=WikiNodeDetailResponse)
async def api_wiki_node_detail(body: WikiNodeDetailRequest) -> WikiNodeDetailResponse:
    return await wiki_local.node_detail(
        body.node_id,
        knowledge_ids=body.knowledge_ids,
        doc_id=body.doc_id,
    )
