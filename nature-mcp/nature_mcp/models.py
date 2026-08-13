"""统一论文命中结构。"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PaperHit(BaseModel):
    title: str = ""
    doi: str | None = None
    abstract: str | None = None
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    journal: str | None = None
    citations: int | None = None
    url: str | None = None
    oa_url: str | None = None
    is_oa: bool | None = None
    source: str = ""
    openalex_id: str | None = None
    s2_id: str | None = None
    note: str | None = None

    def to_public_dict(self) -> dict[str, Any]:
        """对外返回字段；非 OA 不提供可下载原文，仅元数据 + 可选 OA 链接。"""
        payload = self.model_dump()
        if not self.is_oa:
            payload["oa_url"] = None
            payload["note"] = (
                self.note
                or "非开放获取：仅返回元数据（标题/DOI/摘要/引用），不提供原文下载。"
            )
        return payload
