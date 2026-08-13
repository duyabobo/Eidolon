"""Semantic Scholar Graph API。"""
from __future__ import annotations

import logging
from typing import Any

from nature_mcp.clients.http import HttpClient
from nature_mcp.config import Settings
from nature_mcp.models import PaperHit

logger = logging.getLogger(__name__)

S2_SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
S2_PAPER_URL = "https://api.semanticscholar.org/graph/v1/paper"
S2_FIELDS = (
    "paperId,title,abstract,year,venue,citationCount,externalIds,authors,"
    "isOpenAccess,openAccessPdf,url"
)


def _paper_to_hit(paper: dict[str, Any]) -> PaperHit:
    external = paper.get("externalIds") or {}
    doi = external.get("DOI")
    authors = [str(a.get("name")) for a in (paper.get("authors") or []) if a.get("name")]
    oa_pdf = paper.get("openAccessPdf") or {}
    oa_url = oa_pdf.get("url")
    is_oa = bool(paper.get("isOpenAccess")) or bool(oa_url)
    return PaperHit(
        title=str(paper.get("title") or ""),
        doi=doi,
        abstract=paper.get("abstract"),
        authors=authors,
        year=paper.get("year"),
        journal=paper.get("venue"),
        citations=paper.get("citationCount"),
        url=paper.get("url") or (f"https://doi.org/{doi}" if doi else None),
        oa_url=oa_url if is_oa else None,
        is_oa=is_oa,
        source="semanticscholar",
        s2_id=paper.get("paperId"),
    )


class SemanticScholarClient:
    def __init__(self, http: HttpClient, settings: Settings) -> None:
        self._http = http
        self._settings = settings

    def _headers(self) -> dict[str, str]:
        if not self._settings.s2_api_key:
            return {}
        return {"x-api-key": self._settings.s2_api_key}

    async def search(
        self,
        query: str,
        *,
        journals: list[str] | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        open_access_only: bool = False,
        limit: int = 10,
    ) -> list[PaperHit]:
        if not query.strip():
            return []
        params: dict[str, Any] = {
            "query": query,
            "limit": max(1, min(limit, 50)),
            "fields": S2_FIELDS,
        }
        if year_from is not None or year_to is not None:
            start = year_from if year_from is not None else 1900
            end = year_to if year_to is not None else 2100
            params["year"] = f"{start}-{end}"
        if open_access_only:
            params["openAccessPdf"] = ""

        data = await self._http.get_json(
            S2_SEARCH_URL,
            params=params,
            headers=self._headers(),
            label="s2-search",
        )
        if not isinstance(data, dict):
            return []

        hits = [_paper_to_hit(item) for item in (data.get("data") or [])]
        if journals:
            lowered = [j.lower() for j in journals]
            filtered: list[PaperHit] = []
            for hit in hits:
                venue = (hit.journal or "").lower()
                if any(j in venue or venue in j for j in lowered):
                    filtered.append(hit)
            return filtered
        return hits

    async def get_by_doi(self, doi: str) -> PaperHit | None:
        data = await self._http.get_json(
            f"{S2_PAPER_URL}/DOI:{doi}",
            params={"fields": S2_FIELDS},
            headers=self._headers(),
            label="s2-doi",
        )
        if not isinstance(data, dict) or not data.get("paperId"):
            return None
        return _paper_to_hit(data)

    async def get_citations(self, doi: str, *, limit: int = 10) -> list[dict[str, Any]]:
        data = await self._http.get_json(
            f"{S2_PAPER_URL}/DOI:{doi}/citations",
            params={"fields": "citingPaper.title,citingPaper.year,citingPaper.externalIds", "limit": limit},
            headers=self._headers(),
            label="s2-citations",
        )
        if not isinstance(data, dict):
            return []
        out: list[dict[str, Any]] = []
        for item in data.get("data") or []:
            citing = item.get("citingPaper") or {}
            external = citing.get("externalIds") or {}
            out.append(
                {
                    "title": citing.get("title"),
                    "year": citing.get("year"),
                    "doi": external.get("DOI"),
                }
            )
        return out
