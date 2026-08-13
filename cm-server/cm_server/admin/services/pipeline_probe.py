"""探测知识库流水线依赖：mineru-api / reranker。"""
from __future__ import annotations

import asyncio
import logging
import time

import httpx

from cm_server.admin.models.knowledge import KnowledgePipelineConfig, ServiceTestResult
from cm_server.mrag.llm.reranker import ApiReranker

logger = logging.getLogger(__name__)

_PROBE_TIMEOUT_SECONDS = 15.0
_MINERU_PROBE_PATHS = ("/openapi.json", "/docs", "/")


def _normalize_url(url: str) -> str:
    trimmed = (url or "").strip()
    if not trimmed:
        return ""
    if "://" not in trimmed:
        return f"http://{trimmed}"
    return trimmed.rstrip("/")


async def probe_mineru(cfg: KnowledgePipelineConfig) -> ServiceTestResult:
    base = _normalize_url(cfg.mineru3_api_base)
    if not base:
        return ServiceTestResult(ok=False, message="请填写 mineru-api 地址")

    started = time.perf_counter()
    last_error = "无法连接"
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_SECONDS, trust_env=False) as client:
            for path in _MINERU_PROBE_PATHS:
                try:
                    resp = await client.get(f"{base}{path}")
                except httpx.HTTPError as exc:
                    last_error = str(exc).strip() or type(exc).__name__
                    continue
                latency_ms = int((time.perf_counter() - started) * 1000)
                # 能拿到 HTTP 响应即视为服务可达（404 也说明端口通）
                if resp.status_code < 500:
                    logger.info("MinerU 探测成功 base=%s path=%s status=%s", base, path, resp.status_code)
                    return ServiceTestResult(
                        ok=True,
                        latency_ms=latency_ms,
                        message=f"连通正常（HTTP {resp.status_code}）",
                    )
                last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
    except Exception as exc:
        last_error = str(exc).strip()[:500] or type(exc).__name__

    latency_ms = int((time.perf_counter() - started) * 1000)
    logger.warning("MinerU 探测失败 base=%s err=%s", base, last_error)
    return ServiceTestResult(ok=False, latency_ms=latency_ms, message=last_error)


async def probe_reranker(cfg: KnowledgePipelineConfig) -> ServiceTestResult:
    base = _normalize_url(cfg.reranker_base_url)
    if not base:
        return ServiceTestResult(ok=False, message="请填写 reranker URL")

    started = time.perf_counter()
    reranker = ApiReranker(
        base,
        (cfg.reranker_api_key or "").strip(),
        (cfg.reranker_model_name or "").strip() or "reranker",
    )
    try:
        await asyncio.to_thread(reranker.compute_scores, "ping", ["pong"])
        latency_ms = int((time.perf_counter() - started) * 1000)
        logger.info("Reranker 探测成功 base=%s", base)
        return ServiceTestResult(ok=True, latency_ms=latency_ms, message="连通正常")
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        message = str(exc).strip()[:500] or type(exc).__name__
        logger.warning("Reranker 探测失败 base=%s err=%s", base, message)
        return ServiceTestResult(ok=False, latency_ms=latency_ms, message=message)
