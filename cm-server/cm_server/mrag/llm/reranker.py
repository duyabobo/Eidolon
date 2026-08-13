"""可选 Reranker 客户端（检索预留）。"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from cm_server.mrag.settings import MragRuntimeSettings

logger = logging.getLogger(__name__)


class ApiReranker:
    def __init__(self, base_url: str, api_key: str, model_name: str) -> None:
        self.rerank_url = base_url.rstrip("/") + "/rerank"
        self.api_key = api_key
        self.model_name = model_name

    def compute_scores(self, query: str, passages: list[str]) -> list[float]:
        payload = {
            "model": self.model_name,
            "query": query,
            "documents": passages,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        with httpx.Client(timeout=60.0, trust_env=False) as client:
            resp = client.post(self.rerank_url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        return self._parse_scores(data, len(passages))

    def _parse_scores(self, data: dict[str, Any], passage_count: int) -> list[float]:
        scores = [0.0] * passage_count
        results = data.get("results") or data.get("data") or []
        for item in results:
            idx = int(item.get("index", -1))
            score = float(item.get("relevance_score", item.get("score", 0.0)))
            if 0 <= idx < passage_count:
                scores[idx] = score
        return scores

    def healthcheck(self) -> bool:
        try:
            self.compute_scores("ping", ["pong"])
            return True
        except Exception as exc:
            logger.warning("Reranker 健康检查失败: %s", exc)
            return False


def build_reranker(runtime: MragRuntimeSettings) -> ApiReranker | None:
    if not runtime.reranker_enabled:
        return None
    return ApiReranker(
        runtime.reranker_base_url,
        runtime.reranker_api_key,
        runtime.reranker_model_name or "reranker",
    )
