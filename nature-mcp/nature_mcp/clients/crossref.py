"""Crossref Works API。"""
from __future__ import annotations

import logging
import re
from typing import Any

from nature_mcp.clients.http import HttpClient
from nature_mcp.config import Settings
from nature_mcp.models import PaperHit

logger = logging.getLogger(__name__)

CROSSREF_WORKS_URL = "https://api.crossref.org/works"


def _flatten_abstract(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        text = re.sub(r"<[^>]+>", " ", raw)
        return re.sub(r"\s+", " ", text).strip() or None
    return None


def _item_to_hit(item: dict[str, Any]) -> PaperHit:
    title_list = item.get("title") or []
    title = title_list[0] if title_list else ""
    authors = []
    for author in item.get("author") or []:
        given = author.get("given") or ""
        family = author.get("family") or ""
        name = f"{given} {family}".strip()
        if name:
            authors.append(name)
    container = item.get("container-title") or []
    journal = container[0] if container else None
    published = item.get("published-print") or item.get("published-online") or {}
    date_parts = (published.get("date-parts") or [[None]])[0]
    year = date_parts[0] if date_parts else None
    doi = item.get("DOI")
    return PaperHit(
        title=str(title),
        doi=doi,
        abstract=_flatten_abstract(item.get("abstract")),
        authors=authors,
        year=year,
        journal=journal,
        citations=item.get("is-referenced-by-count"),
        url=item.get("URL") or (f"https://doi.org/{doi}" if doi else None),
        oa_url=None,
        is_oa=None,
        source="crossref",
    )


class CrossrefClient:
    def __init__(self, http: HttpClient, settings: Settings) -> None:
        self._http = http
        self._settings = settings

    async def search(
        self,
        query: str,
        *,
        journals: list[str] | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        limit: int = 10,
    ) -> list[PaperHit]:
        params: dict[str, Any] = {
            "query": query or None,
            "rows": max(1, min(limit, 50)),
            "select": "DOI,title,author,container-title,published-print,published-online,"
            "abstract,is-referenced-by-count,URL,type",
            "filter": "type:journal-article",
            "mailto": self._settings.openalex_email,
        }
        filters = ["type:journal-article"]
        if year_from is not None:
            filters.append(f"from-pub-date:{year_from}")
        if year_to is not None:
            filters.append(f"until-pub-date:{year_to}")
        if journals:
            # Crossref container-title 过滤对多刊不友好；先检索再本地过滤
            pass
        params["filter"] = ",".join(filters)
        params = {k: v for k, v in params.items() if v is not None}

        data = await self._http.get_json(CROSSREF_WORKS_URL, params=params, label="crossref-search")
        if not isinstance(data, dict):
            return []
        message = data.get("message") or {}
        hits = [_item_to_hit(item) for item in (message.get("items") or [])]
        if journals:
            lowered = [j.lower() for j in journals]
            return [
                hit
                for hit in hits
                if hit.journal and any(j in hit.journal.lower() or hit.journal.lower() in j for j in lowered)
            ]
        return hits

    async def get_by_doi(self, doi: str) -> PaperHit | None:
        data = await self._http.get_json(
            f"{CROSSREF_WORKS_URL}/{doi}",
            params={"mailto": self._settings.openalex_email},
            label="crossref-doi",
        )
        if not isinstance(data, dict):
            return None
        message = data.get("message")
        if not isinstance(message, dict) or not message.get("DOI"):
            return None
        return _item_to_hit(message)
