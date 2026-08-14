"""探测知识库流水线依赖：mineru-api。"""
from __future__ import annotations

import logging
import time

import httpx

from cm_server.admin.models.knowledge import KnowledgePipelineConfig, ServiceTestResult

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
    api_key = (cfg.mineru3_api_key or "").strip()
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_SECONDS, trust_env=False) as client:
            for path in _MINERU_PROBE_PATHS:
                try:
                    resp = await client.get(f"{base}{path}", headers=headers)
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
