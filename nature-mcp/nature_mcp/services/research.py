"""多源检索编排：OpenAlex 为主，Crossref / S2 补全。"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from nature_mcp.clients.crossref import CrossrefClient
from nature_mcp.clients.openalex import OpenAlexClient
from nature_mcp.clients.semantic_scholar import SemanticScholarClient
from nature_mcp.clients.unpaywall import UnpaywallClient
from nature_mcp.models import PaperHit
from nature_mcp.query import parse_journal_filters

logger = logging.getLogger(__name__)


def _doi_key(doi: str | None) -> str | None:
    if not doi:
        return None
    return doi.strip().lower()


def _merge_hit(base: PaperHit, extra: PaperHit) -> PaperHit:
    data = base.model_dump()
    for field in ("abstract", "citations", "journal", "year", "url", "oa_url", "is_oa", "openalex_id", "s2_id"):
        if not data.get(field) and getattr(extra, field) is not None:
            data[field] = getattr(extra, field)
    if not data.get("authors") and extra.authors:
        data["authors"] = extra.authors
    if extra.is_oa and extra.oa_url:
        data["is_oa"] = True
        data["oa_url"] = extra.oa_url
    sources = {base.source, extra.source}
    data["source"] = "+".join(sorted(s for s in sources if s))
    return PaperHit(**data)


class ResearchService:
    def __init__(
        self,
        openalex: OpenAlexClient,
        s2: SemanticScholarClient,
        crossref: CrossrefClient,
        unpaywall: UnpaywallClient,
    ) -> None:
        self._openalex = openalex
        self._s2 = s2
        self._crossref = crossref
        self._unpaywall = unpaywall

    async def search_papers(
        self,
        query: str,
        *,
        journal: str | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        open_access_only: bool = False,
        limit: int = 10,
    ) -> dict[str, Any]:
        cleaned, journals_from_query = parse_journal_filters(query)
        journals = list(journals_from_query)
        if journal:
            for part in journal.split(","):
                name = part.strip()
                if name and name not in journals:
                    journals.append(name)

        search_query = cleaned or query
        logger.info(
            "search_papers query=%r journals=%s year=%s-%s oa_only=%s limit=%s",
            search_query,
            journals,
            year_from,
            year_to,
            open_access_only,
            limit,
        )

        openalex_task = self._openalex.search(
            search_query,
            journals=journals or None,
            year_from=year_from,
            year_to=year_to,
            open_access_only=open_access_only,
            limit=limit,
        )
        crossref_task = self._crossref.search(
            search_query,
            journals=journals or None,
            year_from=year_from,
            year_to=year_to,
            limit=limit,
        )
        s2_task = self._s2.search(
            search_query,
            journals=journals or None,
            year_from=year_from,
            year_to=year_to,
            open_access_only=open_access_only,
            limit=limit,
        )
        openalex_hits, crossref_hits, s2_hits = await asyncio.gather(
            openalex_task, crossref_task, s2_task
        )

        merged: dict[str, PaperHit] = {}
        untitled: list[PaperHit] = []

        def _ingest(hits: list[PaperHit]) -> None:
            for hit in hits:
                key = _doi_key(hit.doi)
                if not key:
                    untitled.append(hit)
                    continue
                if key in merged:
                    merged[key] = _merge_hit(merged[key], hit)
                else:
                    merged[key] = hit

        # OpenAlex 优先（期刊过滤更准），再合并其他源
        _ingest(openalex_hits)
        _ingest(crossref_hits)
        _ingest(s2_hits)

        results = list(merged.values()) + untitled
        results = results[: max(1, min(limit, 50))]
        return {
            "query": search_query,
            "journals": journals,
            "count": len(results),
            "results": [hit.to_public_dict() for hit in results],
        }

    async def get_paper(
        self,
        identifier: str,
        *,
        include_citations: bool = False,
        resolve_oa: bool = True,
    ) -> dict[str, Any]:
        doi = identifier.strip()
        doi = doi.removeprefix("https://doi.org/").removeprefix("http://doi.org/")
        logger.info("get_paper doi=%s include_citations=%s", doi, include_citations)

        openalex_hit, crossref_hit, s2_hit = await asyncio.gather(
            self._openalex.get_by_doi(doi),
            self._crossref.get_by_doi(doi),
            self._s2.get_by_doi(doi),
        )

        hit: PaperHit | None = None
        for candidate in (openalex_hit, crossref_hit, s2_hit):
            if candidate is None:
                continue
            hit = candidate if hit is None else _merge_hit(hit, candidate)

        if hit is None:
            return {"found": False, "doi": doi, "error": "未找到该 DOI 的公开元数据"}

        payload = hit.to_public_dict()
        payload["found"] = True

        if resolve_oa and doi:
            oa = await self._unpaywall.resolve(doi)
            if oa.get("is_oa") and oa.get("oa_url"):
                payload["is_oa"] = True
                payload["oa_url"] = oa["oa_url"]
                payload["oa_status"] = oa.get("oa_status")
                payload.pop("note", None)
            else:
                payload["is_oa"] = False
                payload["oa_url"] = None
                payload["oa_status"] = oa.get("oa_status")
                payload["note"] = oa.get("note") or payload.get("note")

        if include_citations and doi:
            payload["citing_works"] = await self._s2.get_citations(doi, limit=10)

        return payload

    async def resolve_oa(self, doi: str) -> dict[str, Any]:
        clean = doi.strip().removeprefix("https://doi.org/").removeprefix("http://doi.org/")
        return await self._unpaywall.resolve(clean)
