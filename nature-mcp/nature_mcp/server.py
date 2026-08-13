"""nature-mcp FastMCP server：stdio / Streamable HTTP。"""
from __future__ import annotations

import json
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from nature_mcp.clients.crossref import CrossrefClient
from nature_mcp.clients.http import HttpClient
from nature_mcp.clients.openalex import OpenAlexClient
from nature_mcp.clients.semantic_scholar import SemanticScholarClient
from nature_mcp.clients.unpaywall import UnpaywallClient
from nature_mcp.config import KNOWN_JOURNALS, Settings, load_settings
from nature_mcp.services.research import ResearchService

logger = logging.getLogger(__name__)

SERVER_INSTRUCTIONS = """
学术文献检索 MCP（Nature / Science 等期刊友好）。
数据源：OpenAlex、Semantic Scholar、Crossref、Unpaywall。
检索可用 journal:"Nature" 或 journal:"Science" 过滤期刊。
返回标题、DOI、摘要、引用数、合法 OA 链接；非 OA 仅元数据，不提供原文下载。
"""


def _build_transport_security(settings: Settings) -> TransportSecuritySettings:
    allowed_hosts = list(settings.allowed_hosts)
    # 通配端口，兼容 Electron 动态端口
    for host in ("127.0.0.1", "localhost", "nature-mcp"):
        wildcard = f"{host}:*"
        if wildcard not in allowed_hosts:
            allowed_hosts.append(wildcard)
    allowed_origins = [
        f"http://{h}" if "://" not in h else h
        for h in allowed_hosts
        if not h.endswith(":*")
    ]
    for host in ("127.0.0.1", "localhost"):
        allowed_origins.append(f"http://{host}:*")
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=allowed_hosts,
        allowed_origins=allowed_origins,
    )


def create_mcp(settings: Settings | None = None) -> FastMCP:
    settings = settings or load_settings()
    http = HttpClient(settings)
    service = ResearchService(
        openalex=OpenAlexClient(http, settings),
        s2=SemanticScholarClient(http, settings),
        crossref=CrossrefClient(http, settings),
        unpaywall=UnpaywallClient(http, settings),
    )

    mcp = FastMCP(
        "nature",
        instructions=SERVER_INSTRUCTIONS.strip(),
        host=settings.host,
        port=settings.port,
        streamable_http_path="/mcp",
        stateless_http=True,
        transport_security=_build_transport_security(settings),
    )

    @mcp.tool()
    async def search_papers(
        query: str,
        journal: str | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        open_access_only: bool = False,
        limit: int = 10,
    ) -> str:
        """搜索学术论文（OpenAlex + Crossref + Semantic Scholar）。

        可用 journal:"Nature" / journal:"Science" 写在 query 里，或传 journal 参数。
        返回标题、DOI、摘要、引用、OA 链接；非 OA 仅元数据。
        """
        result = await service.search_papers(
            query,
            journal=journal,
            year_from=year_from,
            year_to=year_to,
            open_access_only=open_access_only,
            limit=limit,
        )
        return json.dumps(result, ensure_ascii=False, indent=2)

    @mcp.tool()
    async def get_paper(
        identifier: str,
        include_citations: bool = False,
        resolve_oa: bool = True,
    ) -> str:
        """按 DOI 获取单篇论文元数据；可选引用列表与 Unpaywall OA 解析。

        非开放获取论文只返回元数据，不会下载或返回付费原文。
        """
        result = await service.get_paper(
            identifier,
            include_citations=include_citations,
            resolve_oa=resolve_oa,
        )
        return json.dumps(result, ensure_ascii=False, indent=2)

    @mcp.tool()
    async def resolve_oa(doi: str) -> str:
        """用 Unpaywall 解析 DOI 的合法开放获取链接；无 OA 时仅说明状态。"""
        result = await service.resolve_oa(doi)
        return json.dumps(result, ensure_ascii=False, indent=2)

    @mcp.tool()
    async def list_known_journals() -> str:
        """列出内置精确匹配的期刊（Nature / Science 等）及其 OpenAlex source id。"""
        payload: dict[str, Any] = {
            "journals": [
                {
                    "key": key,
                    "display_name": meta["display_name"],
                    "issn": meta["issn"],
                    "openalex_id": meta["openalex_id"],
                }
                for key, meta in KNOWN_JOURNALS.items()
            ],
            "usage": 'search_papers(query=\'CRISPR journal:"Nature"\') 或 journal="Science"',
        }
        return json.dumps(payload, ensure_ascii=False, indent=2)

    # 挂到 mcp 上便于测试关闭 http 客户端
    mcp._nature_http = http  # type: ignore[attr-defined]
    return mcp


def main() -> None:
    settings = load_settings()
    logging.getLogger().setLevel(settings.log_level)
    logger.info(
        "nature-mcp 启动 transport=%s host=%s port=%s",
        settings.transport,
        settings.host,
        settings.port,
    )
    mcp = create_mcp(settings)
    if settings.transport == "stdio":
        mcp.run(transport="stdio")
    else:
        mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
