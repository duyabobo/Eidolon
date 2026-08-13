"""知识库流水线运行时参数：合并 Settings 默认值与 DB knowledge_pipeline。"""
from __future__ import annotations

from dataclasses import dataclass

from cm_server.admin.models.knowledge import KnowledgePipelineConfig
from cm_server.config import settings


@dataclass(frozen=True)
class MragRuntimeSettings:
    mineru3_api_base: str
    mineru3_backend: str
    mineru3_lang: str
    mineru3_parse_method: str
    mineru_vlm_url: str
    reranker_base_url: str
    reranker_api_key: str
    reranker_model_name: str
    llm_max_concurrent: int
    vlm_max_concurrent: int
    fixed_chunk_chars: int
    fixed_chunk_overlap_chars: int
    wiki_leaf_max_chars: int
    understand_tree_concurrency: int
    mineru3_poll_interval_seconds: float
    mineru3_poll_timeout_seconds: float
    mineru3_submit_timeout_seconds: float
    phase1_md_name: str
    phase2_tree_name: str

    @property
    def vlm_enabled(self) -> bool:
        return bool(self.mineru_vlm_url.strip())

    @property
    def reranker_enabled(self) -> bool:
        return bool(self.reranker_base_url.strip())


def build_runtime_settings(pipeline: KnowledgePipelineConfig) -> MragRuntimeSettings:
    from cm_server.admin.constants.knowledge import PHASE1_MD_NAME, PHASE2_TREE_NAME

    return MragRuntimeSettings(
        mineru3_api_base=pipeline.mineru3_api_base.strip(),
        mineru3_backend=pipeline.mineru3_backend or "pipeline",
        mineru3_lang=pipeline.mineru3_lang or "ch",
        mineru3_parse_method=pipeline.mineru3_parse_method or "auto",
        mineru_vlm_url=pipeline.mineru_vlm_url.strip(),
        reranker_base_url=pipeline.reranker_base_url.strip(),
        reranker_api_key=pipeline.reranker_api_key,
        reranker_model_name=pipeline.reranker_model_name or "reranker",
        llm_max_concurrent=settings.knowledge_llm_max_concurrent,
        vlm_max_concurrent=settings.knowledge_vlm_max_concurrent,
        fixed_chunk_chars=settings.knowledge_fixed_chunk_chars,
        fixed_chunk_overlap_chars=settings.knowledge_fixed_chunk_overlap_chars,
        wiki_leaf_max_chars=settings.knowledge_wiki_leaf_max_chars,
        understand_tree_concurrency=settings.knowledge_understand_tree_concurrency,
        mineru3_poll_interval_seconds=settings.knowledge_mineru3_poll_interval_seconds,
        mineru3_poll_timeout_seconds=settings.knowledge_mineru3_poll_timeout_seconds,
        mineru3_submit_timeout_seconds=settings.knowledge_mineru3_submit_timeout_seconds,
        phase1_md_name=PHASE1_MD_NAME,
        phase2_tree_name=PHASE2_TREE_NAME,
    )
