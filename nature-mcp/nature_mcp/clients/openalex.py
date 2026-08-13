"""OpenAlex Works API。"""
from __future__ import annotations

import logging
import re
from typing import Any

from nature_mcp.clients.http import HttpClient
from nature_mcp.config import KNOWN_JOURNALS, Settings
from nature_mcp.models import PaperHit
from nature_mcp.query import normalize_journal_key

logger = logging.getLogger(__name__)

OPENALEX_WORKS_URL = "https://api.openalex.org/works"
OPENALEX_SOURCES_URL = "https://api.openalex.org/sources"


def _reconstruct_abstract(inverted_index: dict[str, list[int]] | None) -> str | None:
    if not inverted_index:
        return None
    positions: dict[int, str] = {}
    for token, idxs in inverted_index.items():
        for idx in idxs:
            positions[idx] = token
    if not positions:
        return None
    return " ".join(positions[i] for i in sorted(positions))


def _clean_doi(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw.strip()
    value = re.sub(r"^https?://(dx\.)?doi\.org/", "", value, flags=re.IGNORECASE)
    return value or None


def _work_to_hit(work: dict[str, Any]) -> PaperHit:
    primary = work.get("primary_location") or {}
    source = primary.get("source") or {}
    oa = work.get("open_access") or {}
    authors = []
    for authorship in work.get("authorships") or []:
        author = authorship.get("author") or {}
        name = author.get("display_name")
        if name:
            authors.append(str(name))

    best_oa = work.get("best_oa_location") or {}
    oa_url = best_oa.get("pdf_url") or best_oa.get("landing_page_url")
    is_oa = bool(oa.get("is_oa")) if oa.get("is_oa") is not None else bool(oa_url)

    return PaperHit(
        title=str(work.get("display_name") or ""),
        doi=_clean_doi(work.get("doi")),
        abstract=_reconstruct_abstract(work.get("abstract_inverted_index")),
        authors=authors,
        year=work.get("publication_year"),
        journal=source.get("display_name"),
        citations=work.get("cited_by_count"),
        url=work.get("id") or (f"https://doi.org/{_clean_doi(work.get('doi'))}" if work.get("doi") else None),
        oa_url=oa_url if is_oa else None,
        is_oa=is_oa,
        source="openalex",
        openalex_id=str(work.get("id") or "").rsplit("/", 1)[-1] or None,
    )


class OpenAlexClient:
    def __init__(self, http: HttpClient, settings: Settings) -> None:
        self._http = http
        self._settings = settings
        self._source_cache: dict[str, str] = {
            key: meta["openalex_id"] for key, meta in KNOWN_JOURNALS.items()
        }

    def _mailto_params(self) -> dict[str, str]:
        return {"mailto": self._settings.openalex_email}

    async def resolve_source_id(self, journal_name: str) -> str | None:
        key = normalize_journal_key(journal_name)
        if key in self._source_cache:
            return self._source_cache[key]

        known = KNOWN_JOURNALS.get(key)
        if known:
            self._source_cache[key] = known["openalex_id"]
            return known["openalex_id"]

        data = await self._http.get_json(
            OPENALEX_SOURCES_URL,
            params={"search": journal_name, "per_page": 5, **self._mailto_params()},
            label="openalex-sources",
        )
        if not isinstance(data, dict):
            return None
        results = data.get("results") or []
        for item in results:
            display = normalize_journal_key(str(item.get("display_name") or ""))
            source_id = str(item.get("id") or "").rsplit("/", 1)[-1]
            if not source_id:
                continue
            if display == key or key in display:
                self._source_cache[key] = source_id
                logger.info("OpenAlex source 解析 journal=%s id=%s", journal_name, source_id)
                return source_id
        if results:
            source_id = str(results[0].get("id") or "").rsplit("/", 1)[-1]
            if source_id:
                self._source_cache[key] = source_id
                return source_id
        return None

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
        filters: list[str] = ["type:article"]
        if open_access_only:
            filters.append("is_oa:true")
        if year_from is not None and year_to is not None:
            filters.append(f"publication_year:{year_from}-{year_to}")
        elif year_from is not None:
            filters.append(f"from_publication_date:{year_from}-01-01")
        elif year_to is not None:
            filters.append(f"to_publication_date:{year_to}-12-31")

        if journals:
            source_ids: list[str] = []
            for name in journals:
                source_id = await self.resolve_source_id(name)
                if source_id:
                    source_ids.append(source_id)
            if source_ids:
                filters.append("primary_location.source.id:" + "|".join(source_ids))
            else:
                logger.warning("未能解析任何 journal filter: %s", journals)

        params: dict[str, Any] = {
            "search": query or None,
            "filter": ",".join(filters),
            "per_page": max(1, min(limit, 50)),
            "sort": "relevance_score:desc",
            **self._mailto_params(),
        }
        params = {k: v for k, v in params.items() if v is not None}

        data = await self._http.get_json(OPENALEX_WORKS_URL, params=params, label="openalex-works")
        if not isinstance(data, dict):
            return []
        return [_work_to_hit(item) for item in (data.get("results") or [])]

    async def get_by_doi(self, doi: str) -> PaperHit | None:
        clean = _clean_doi(doi)
        if not clean:
            return None
        data = await self._http.get_json(
            f"{OPENALEX_WORKS_URL}/doi:{clean}",
            params=self._mailto_params(),
            label="openalex-doi",
        )
        if not isinstance(data, dict) or not data.get("id"):
            return None
        return _work_to_hit(data)
