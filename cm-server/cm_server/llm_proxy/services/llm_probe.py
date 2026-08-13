"""探测 LLM Provider：发一条极短 completion，验证凭据与连通性。"""
from __future__ import annotations

import logging
import time

import httpx

from cm_server.llm_proxy.models.config import LlmProfile, ServiceTestResult

logger = logging.getLogger(__name__)

_PROBE_TIMEOUT_SECONDS = 30.0
_ANTHROPIC_VERSION = "2023-06-01"
_PROBE_MAX_TOKENS = 8


async def probe_llm_profile(profile: LlmProfile) -> ServiceTestResult:
    started = time.perf_counter()
    try:
        if profile.protocol == "anthropic":
            await _probe_anthropic(profile)
        else:
            await _probe_openai(profile)
        latency_ms = int((time.perf_counter() - started) * 1000)
        logger.info(
            "LLM 探测成功 id=%s name=%s protocol=%s latency=%dms",
            profile.id,
            profile.name,
            profile.protocol,
            latency_ms,
        )
        return ServiceTestResult(ok=True, latency_ms=latency_ms, message="连通正常")
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        message = str(exc).strip()[:500] or type(exc).__name__
        logger.warning(
            "LLM 探测失败 id=%s name=%s err=%s",
            profile.id,
            profile.name,
            message,
        )
        return ServiceTestResult(ok=False, latency_ms=latency_ms, message=message)


async def _probe_openai(profile: LlmProfile) -> None:
    url = f"{profile.base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {profile.api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": profile.model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": _PROBE_MAX_TOKENS,
        "temperature": 0,
    }
    timeout = min(float(profile.timeout or _PROBE_TIMEOUT_SECONDS), _PROBE_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        resp = await client.post(url, headers=headers, json=body)
    if resp.status_code != 200:
        raise RuntimeError(f"上游返回 {resp.status_code}: {resp.text[:300]}")


async def _probe_anthropic(profile: LlmProfile) -> None:
    url = f"{profile.base_url.rstrip('/')}/v1/messages"
    headers = {
        "x-api-key": profile.api_key,
        "anthropic-version": _ANTHROPIC_VERSION,
        "Content-Type": "application/json",
    }
    body = {
        "model": profile.model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": _PROBE_MAX_TOKENS,
    }
    timeout = min(float(profile.timeout or _PROBE_TIMEOUT_SECONDS), _PROBE_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        resp = await client.post(url, headers=headers, json=body)
    if resp.status_code != 200:
        raise RuntimeError(f"上游返回 {resp.status_code}: {resp.text[:300]}")
