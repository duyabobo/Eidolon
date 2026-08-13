"""Unpaywall：合法 OA PDF / landing page 解析。"""
from __future__ import annotations

import logging
from typing import Any

from nature_mcp.clients.http import HttpClient
from nature_mcp.config import Settings

logger = logging.getLogger(__name__)

UNPAYWALL_URL = "https://api.unpaywall.org/v2"


class UnpaywallClient:
    def __init__(self, http: HttpClient, settings: Settings) -> None:
        self._http = http
        self._settings = settings

    async def resolve(self, doi: str) -> dict[str, Any]:
        data = await self._http.get_json(
            f"{UNPAYWALL_URL}/{doi}",
            params={"email": self._settings.unpaywall_email},
            label="unpaywall",
        )
        if not isinstance(data, dict):
            return {"doi": doi, "is_oa": False, "oa_url": None, "oa_status": None}

        best = data.get("best_oa_location") or {}
        oa_url = best.get("url_for_pdf") or best.get("url")
        is_oa = bool(data.get("is_oa")) and bool(oa_url)
        result = {
            "doi": data.get("doi") or doi,
            "is_oa": is_oa,
            "oa_url": oa_url if is_oa else None,
            "oa_status": data.get("oa_status"),
            "journal_name": data.get("journal_name"),
            "title": data.get("title"),
            "year": data.get("year"),
            "publisher": data.get("publisher"),
        }
        if not is_oa:
            result["note"] = "非开放获取：Unpaywall 未找到合法 OA 链接，仅可使用元数据。"
        logger.info(
            "Unpaywall 解析 doi=%s is_oa=%s oa_status=%s",
            doi,
            result["is_oa"],
            result.get("oa_status"),
        )
        return result
