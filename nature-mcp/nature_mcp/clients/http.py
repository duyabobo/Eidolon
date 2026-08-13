"""共享异步 HTTP 客户端。"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from nature_mcp.config import Settings

logger = logging.getLogger(__name__)


class HttpClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = httpx.AsyncClient(
            timeout=settings.request_timeout_seconds,
            headers={"User-Agent": settings.user_agent},
            follow_redirects=True,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def get_json(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        label: str = "http",
    ) -> dict[str, Any] | list[Any] | None:
        try:
            response = await self._client.get(url, params=params, headers=headers)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as exc:
            logger.warning("%s 请求失败 url=%s err=%s", label, url, exc)
            return None
