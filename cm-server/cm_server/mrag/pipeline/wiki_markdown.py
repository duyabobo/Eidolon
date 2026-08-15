"""Wiki 节点 Markdown 序列化 / 解析：元数据 + 摘要 + 详情 + 引用。"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

_FENCE_RE = re.compile(r"^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$", re.IGNORECASE)
_META_LINE_RE = re.compile(r"^-\s*([A-Za-z0-9_\u4e00-\u9fff]+)\s*:\s*(.*)\s*$")
_H1_RE = re.compile(r"^#\s+(.+?)\s*$")
_H2_RE = re.compile(r"^##\s+(.+?)\s*$")

SECTION_OVERVIEW = "摘要"
SECTION_BODY = "详情"
SECTION_REFERENCES = "引用"
SECTION_METADATA = "元数据"

# 兼容旧编译产物 / LLM 偶发英文标题
_SECTION_ALIASES: dict[str, str] = {
    "摘要": SECTION_OVERVIEW,
    "overview": SECTION_OVERVIEW,
    "summary": SECTION_OVERVIEW,
    "详情": SECTION_BODY,
    "detail": SECTION_BODY,
    "details": SECTION_BODY,
    "正文": SECTION_BODY,
    "body": SECTION_BODY,
    "引用": SECTION_REFERENCES,
    "references": SECTION_REFERENCES,
    "refs": SECTION_REFERENCES,
    "元数据": SECTION_METADATA,
    "metadata": SECTION_METADATA,
    "meta": SECTION_METADATA,
}


@dataclass
class WikiNodeDocument:
    """磁盘上的结构化 Wiki 知识节点。"""

    node_id: str
    title: str
    node_type: str = ""
    source: str = ""
    source_date: str = ""
    created_at: str = ""
    source_leaf_id: str = ""
    overview: str = ""
    body: str = ""
    references: str = ""
    extra_meta: dict[str, str] = field(default_factory=dict)

    def to_markdown(self) -> str:
        meta_lines = [
            f"- type: {self.node_type or ''}",
            f"- id: {self.node_id}",
            f"- source: {self.source or ''}",
            f"- source_date: {self.source_date or ''}",
            f"- created_at: {self.created_at or ''}",
            f"- source_leaf_id: {self.source_leaf_id or ''}",
        ]
        for key, value in self.extra_meta.items():
            if key in {"type", "id", "source", "source_date", "created_at", "source_leaf_id"}:
                continue
            meta_lines.append(f"- {key}: {value}")

        parts = [
            f"# {self.title.strip() or self.node_id}",
            "",
            f"## {SECTION_METADATA}",
            "",
            *meta_lines,
            "",
            f"## {SECTION_OVERVIEW}",
            "",
            (self.overview or "").strip() or "（无）",
            "",
            f"## {SECTION_BODY}",
            "",
            (self.body or "").strip() or "（无）",
            "",
            f"## {SECTION_REFERENCES}",
            "",
            (self.references or "").strip() or "无",
            "",
        ]
        return "\n".join(parts)


def _strip_fence(text: str) -> str:
    raw = (text or "").strip()
    match = _FENCE_RE.match(raw)
    return match.group(1).strip() if match else raw


def _normalize_section_name(name: str) -> str:
    key = (name or "").strip()
    return _SECTION_ALIASES.get(key, _SECTION_ALIASES.get(key.lower(), key))


def parse_wiki_markdown(text: str, *, fallback_id: str = "") -> WikiNodeDocument:
    """解析结构化 Wiki MD；兼容旧格式（无分节时整篇作为详情）。"""
    content = _strip_fence(text)
    lines = content.splitlines()

    title = fallback_id or "untitled"
    idx = 0
    if lines:
        h1 = _H1_RE.match(lines[0].strip())
        if h1:
            title = h1.group(1).strip() or title
            idx = 1

    # 旧格式：H1 后直接是 - type/id 列表（无 ## 元数据）
    legacy_meta: dict[str, str] = {}
    while idx < len(lines):
        stripped = lines[idx].strip()
        if not stripped:
            idx += 1
            continue
        if _H2_RE.match(stripped):
            break
        meta_match = _META_LINE_RE.match(stripped)
        if meta_match:
            legacy_meta[meta_match.group(1)] = meta_match.group(2).strip()
            idx += 1
            continue
        break

    sections: dict[str, list[str]] = {}
    current: str | None = None
    while idx < len(lines):
        stripped = lines[idx].strip()
        h2 = _H2_RE.match(stripped)
        if h2:
            current = _normalize_section_name(h2.group(1))
            sections.setdefault(current, [])
            idx += 1
            continue
        if current is None:
            # 无分节：剩余全部视为详情
            current = SECTION_BODY
            sections.setdefault(current, [])
        sections[current].append(lines[idx])
        idx += 1

    meta: dict[str, str] = dict(legacy_meta)
    meta_block = "\n".join(sections.get(SECTION_METADATA, [])).strip()
    if meta_block:
        for line in meta_block.splitlines():
            match = _META_LINE_RE.match(line.strip())
            if match:
                meta[match.group(1)] = match.group(2).strip()

    def _section_text(name: str) -> str:
        raw = "\n".join(sections.get(name, [])).strip()
        if raw in {"（无）", "无", "-"}:
            return ""
        return raw

    overview = _section_text(SECTION_OVERVIEW)
    body = _section_text(SECTION_BODY)
    references = _section_text(SECTION_REFERENCES)

    # 旧产物：只有一整块 body、没有摘要分节 → 不把 body 截断冒充摘要
    if SECTION_OVERVIEW not in sections and SECTION_BODY not in sections and not body:
        # 完全无 ## 分节时，sections 可能已写入 SECTION_BODY
        pass
    if SECTION_OVERVIEW not in sections and SECTION_BODY in sections and not overview:
        # 明确：旧格式不复制 body 到 overview
        overview = ""

    known_meta_keys = {"type", "id", "source", "source_date", "created_at", "source_leaf_id"}
    extra = {k: v for k, v in meta.items() if k not in known_meta_keys}

    return WikiNodeDocument(
        node_id=meta.get("id") or fallback_id or title,
        title=title,
        node_type=meta.get("type") or "",
        source=meta.get("source") or "",
        source_date=meta.get("source_date") or "",
        created_at=meta.get("created_at") or "",
        source_leaf_id=meta.get("source_leaf_id") or "",
        overview=overview,
        body=body,
        references=references,
        extra_meta=extra,
    )


def extract_structured_wiki(llm_text: str, *, fallback_title: str, fallback_id: str) -> WikiNodeDocument:
    """从 LLM 输出解析结构化节点；解析失败时把原文放入详情。"""
    doc = parse_wiki_markdown(llm_text, fallback_id=fallback_id)
    if not doc.title or doc.title == fallback_id:
        doc.title = fallback_title or doc.title
    if not doc.body and not doc.overview:
        cleaned = _strip_fence(llm_text).strip()
        doc.body = cleaned or "（编译结果为空）"
    return doc


def _split_by_h1(text: str) -> list[str]:
    lines = (text or "").splitlines()
    starts = [i for i, line in enumerate(lines) if _H1_RE.match(line.strip())]
    if len(starts) <= 1:
        return [text.strip()] if text.strip() else []
    parts: list[str] = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(lines)
        part = "\n".join(lines[start:end]).strip()
        if part:
            parts.append(part)
    return parts


def split_wiki_llm_output(text: str) -> list[str]:
    """把一次 LLM 输出拆成多条 Wiki 文档（--- 或连续一级标题）。"""
    raw = _strip_fence(text).strip()
    if not raw:
        return []
    chunks = [p.strip() for p in re.split(r"^\s*---\s*$", raw, flags=re.MULTILINE) if p.strip()]
    parts: list[str] = []
    for chunk in chunks:
        parts.extend(_split_by_h1(chunk) or [chunk])
    return parts


def extract_structured_wiki_many(
    llm_text: str,
    *,
    fallback_title: str,
    fallback_id: str,
) -> list[WikiNodeDocument]:
    """解析一次回复中的多条知识节点。"""
    parts = split_wiki_llm_output(llm_text)
    if not parts:
        return [extract_structured_wiki(llm_text, fallback_title=fallback_title, fallback_id=fallback_id)]
    docs: list[WikiNodeDocument] = []
    multi = len(parts) > 1
    for index, part in enumerate(parts, start=1):
        node_id = f"{fallback_id}_{index}" if multi else fallback_id
        docs.append(
            extract_structured_wiki(part, fallback_title=fallback_title, fallback_id=node_id)
        )
    return docs
