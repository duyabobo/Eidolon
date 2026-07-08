from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ChunkingConfig(BaseModel):
    chunk_size: int = Field(default=512, ge=128, le=4096)
    chunk_overlap: int = Field(default=100, ge=0, le=1024)


class KnowledgeBaseCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = Field(default="", max_length=512)
    type: Literal["document", "multimodal"] = "document"
    chunking_config: ChunkingConfig | None = None


class KnowledgeBaseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    chunking_config: ChunkingConfig | None = None


class KnowledgeBase(BaseModel):
    id: str
    name: str
    description: str = ""
    type: str = "document"
    document_count: int = 0
    chunking_config: ChunkingConfig | None = None
    created_at: datetime
    updated_at: datetime


class KnowledgeBaseList(BaseModel):
    items: list[KnowledgeBase]
    total: int
    page: int
    page_size: int


class KnowledgeDocument(BaseModel):
    id: str
    kb_id: str
    name: str
    file_size: int
    status: Literal["uploaded", "processing", "indexed", "failed"] = "uploaded"
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime


class KnowledgeDocumentList(BaseModel):
    items: list[KnowledgeDocument]
    total: int
    page: int
    page_size: int
