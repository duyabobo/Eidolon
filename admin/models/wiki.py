from typing import Any

from pydantic import BaseModel, Field


class WikiGraphByDocRequest(BaseModel):
    doc_id: str = Field(..., min_length=1)
    knowledge_ids: list[str] | None = None
    max_nodes: int = Field(default=500, ge=1, le=2000)


class WikiGraphNode(BaseModel):
    node_id: str
    title: str
    type: str = ""
    source: str = ""
    tree_node_id: str = ""
    knowledge_id: str = ""
    tags: list[str] = Field(default_factory=list)
    created_at: str = ""


class WikiGraphEdge(BaseModel):
    source_id: str
    target_id: str
    description: str = ""
    source_doc_id: str = ""


class WikiDocumentGraphResponse(BaseModel):
    doc_id: str
    node_count: int
    edge_count: int
    nodes: list[WikiGraphNode]
    edges: list[WikiGraphEdge]
    took_ms: int = 0


class WikiNodeDetailRequest(BaseModel):
    node_id: str = Field(..., min_length=1)
    knowledge_ids: list[str] | None = None


class WikiNodeItem(BaseModel):
    node_id: str
    title: str
    type: str = ""
    source: str = ""
    source_doc_id: str = ""
    knowledge_id: str = ""
    tree_node_id: str = ""
    tags: list[str] = Field(default_factory=list)
    keywords_en: list[str] = Field(default_factory=list)
    keywords_zh: list[str] = Field(default_factory=list)
    overview: str = ""
    body: str = ""
    body_sections: dict[str, str] = Field(default_factory=dict)
    references: str = ""
    connections: list[Any] = Field(default_factory=list)
    attachment_oss_url: str = ""
    created_at: str = ""
    doc_lang: str = ""
    score: float | None = None


class WikiNodeDetailResponse(BaseModel):
    node: WikiNodeItem
    took_ms: int = 0
