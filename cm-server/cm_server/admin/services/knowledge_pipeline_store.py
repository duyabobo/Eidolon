"""知识库流水线配置（mineru / reranker），存 app_config.knowledge_pipeline。"""
from __future__ import annotations

import logging

from fastapi import HTTPException, status
from pi_shared import format_iso, now_china
from pi_shared.sqlite import dumps, loads

from cm_server.admin.models.knowledge import KnowledgePipelineConfig
from cm_server.admin.services.db import get_db

logger = logging.getLogger(__name__)

_CONFIG_KEY = "knowledge_pipeline"


def _normalize_url(url: str) -> str:
    trimmed = (url or "").strip()
    if not trimmed:
        return ""
    if "://" not in trimmed:
        return f"http://{trimmed}"
    return trimmed.rstrip("/")


def _row_to_config(raw: str | None) -> KnowledgePipelineConfig:
    data = loads(raw, {}) or {}
    if not isinstance(data, dict):
        data = {}
    return KnowledgePipelineConfig(
        mineru3_api_base=_normalize_url(str(data.get("mineru3_api_base", ""))),
        mineru3_backend=str(data.get("mineru3_backend") or "pipeline"),
        mineru3_lang=str(data.get("mineru3_lang") or "ch"),
        mineru3_parse_method=str(data.get("mineru3_parse_method") or "auto"),
        mineru_vlm_url=_normalize_url(str(data.get("mineru_vlm_url", ""))),
        reranker_base_url=_normalize_url(str(data.get("reranker_base_url", ""))),
        reranker_api_key=str(data.get("reranker_api_key") or ""),
        reranker_model_name=str(data.get("reranker_model_name") or ""),
        updated_at=data.get("updated_at"),
    )


async def get_pipeline_config() -> KnowledgePipelineConfig:
    row = await get_db().fetch_one(
        "SELECT value FROM app_config WHERE key = ?",
        (_CONFIG_KEY,),
    )
    return _row_to_config(row["value"] if row else None)


async def save_pipeline_config(cfg: KnowledgePipelineConfig) -> KnowledgePipelineConfig:
    mineru_base = _normalize_url(cfg.mineru3_api_base)
    if not mineru_base:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请配置 mineru-api 地址（mineru3_api_base）",
        )

    now = format_iso(now_china())
    payload = KnowledgePipelineConfig(
        mineru3_api_base=mineru_base,
        mineru3_backend=(cfg.mineru3_backend or "pipeline").strip() or "pipeline",
        mineru3_lang=(cfg.mineru3_lang or "ch").strip() or "ch",
        mineru3_parse_method=(cfg.mineru3_parse_method or "auto").strip() or "auto",
        mineru_vlm_url=_normalize_url(cfg.mineru_vlm_url),
        reranker_base_url=_normalize_url(cfg.reranker_base_url),
        reranker_api_key=(cfg.reranker_api_key or "").strip(),
        reranker_model_name=(cfg.reranker_model_name or "").strip(),
        updated_at=now,
    )
    value = dumps(payload.model_dump(mode="json"))
    await get_db().execute(
        """
        INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (_CONFIG_KEY, value, now),
    )
    logger.info(
        "知识库流水线配置已保存 mineru=%s reranker=%s",
        payload.mineru3_api_base,
        payload.reranker_base_url or "(未启用)",
    )
    return payload


async def require_mineru_configured() -> KnowledgePipelineConfig:
    cfg = await get_pipeline_config()
    if not cfg.mineru_configured:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先在知识库页面配置 mineru-api 地址",
        )
    return cfg
