"""解析检索查询中的 journal:\"Name\" 语法。"""
from __future__ import annotations

import re

_JOURNAL_PATTERN = re.compile(
    r"""\bjournal\s*:\s*(?:"([^"]+)"|'([^']+)'|(\S+))""",
    re.IGNORECASE,
)


def parse_journal_filters(query: str) -> tuple[str, list[str]]:
    """从查询中剥离 journal 过滤条件，返回 (cleaned_query, journals)。"""
    journals: list[str] = []

    def _collect(match: re.Match[str]) -> str:
        name = match.group(1) or match.group(2) or match.group(3) or ""
        name = name.strip()
        if name:
            journals.append(name)
        return " "

    cleaned = _JOURNAL_PATTERN.sub(_collect, query)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned, journals


def normalize_journal_key(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower())
