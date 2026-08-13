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
    wiki_compiled: bool = False
    created_at: datetime
    updated_at: datetime


class KnowledgeDocumentList(BaseModel):
    items: list[KnowledgeDocument]
    total: int
    page: int
    page_size: int


class KnowledgePipelineConfig(BaseModel):
    """知识库流水线配置：mineru-api 必填，reranker 可选。"""

    mineru3_api_base: str = Field(default="", max_length=512)
    mineru3_backend: str = Field(default="pipeline", max_length=64)
    mineru3_lang: str = Field(default="ch", max_length=32)
    mineru3_parse_method: str = Field(default="auto", max_length=32)
    mineru_vlm_url: str = Field(default="", max_length=512)
    reranker_base_url: str = Field(default="", max_length=512)
    reranker_api_key: str = Field(default="", max_length=512)
    reranker_model_name: str = Field(default="", max_length=128)
    updated_at: datetime | None = None

    @property
    def mineru_configured(self) -> bool:
        return bool(self.mineru3_api_base.strip())

    @property
    def reranker_enabled(self) -> bool:
        return bool(self.reranker_base_url.strip())

    @property
    def vlm_enabled(self) -> bool:
        return bool(self.mineru_vlm_url.strip())


class ServiceTestResult(BaseModel):
    ok: bool
    latency_ms: int = 0
    message: str = ""


# 兼容旧前端类型名（逐步删除）
KnowledgeServiceConfig = KnowledgePipelineConfig
