import logging
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status

from cm_server.admin.constants.knowledge import KNOWLEDGE_KEY_HEADER
from cm_server.admin.models.wiki import (
    WikiDocumentGraphResponse,
    WikiGraphByDocRequest,
    WikiNodeDetailRequest,
    WikiNodeDetailResponse,
)
from cm_server.admin.routes.knowledge_deps import require_knowledge_key
from cm_server.admin.services import knowledge_config_store, wiki_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config/knowledge/wiki", tags=["knowledge-wiki"])


async def _require_remote_mode() -> None:
    if not await knowledge_config_store.is_remote_mode():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Wiki 知识图谱需配置远程知识库服务地址",
        )


@router.post("/graph/by_doc", response_model=WikiDocumentGraphResponse)
async def api_wiki_graph_by_doc(
    body: WikiGraphByDocRequest,
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
) -> WikiDocumentGraphResponse:
    await _require_remote_mode()
    return await wiki_client.graph_by_doc(require_knowledge_key(x_knowledge_key), body)


@router.post("/nodes/detail", response_model=WikiNodeDetailResponse)
async def api_wiki_node_detail(
    body: WikiNodeDetailRequest,
    x_knowledge_key: Annotated[str | None, Header(alias=KNOWLEDGE_KEY_HEADER)] = None,
) -> WikiNodeDetailResponse:
    await _require_remote_mode()
    return await wiki_client.node_detail(require_knowledge_key(x_knowledge_key), body)
