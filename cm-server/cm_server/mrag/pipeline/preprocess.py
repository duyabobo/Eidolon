"""Phase2：优先识别原文目录建树；否则 LLM 抽取目录树；最后定长切分兜底。"""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Optional

from cm_server.mrag.llm.client import LlmClient
from cm_server.mrag.pipeline.models import DocNode, DocTree
from cm_server.mrag.settings import MragRuntimeSettings

logger = logging.getLogger(__name__)

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)
_TOC_HEADING_RE = re.compile(
    r"^(#{1,6})\s*(目录|Contents|Table of Contents|CONTENTS)\s*$",
    re.MULTILINE | re.IGNORECASE,
)
_JSON_ARRAY_RE = re.compile(r"\[[\s\S]*\]")
_LLM_TOC_MAX_CHARS = 24000
_MIN_HEADINGS_FOR_NATIVE_TOC = 2

_TOC_SYSTEM_PROMPT = (
    "你是文档目录分析助手。只输出 JSON 数组，不要前言，不要代码围栏。"
)

_TOC_PROMPT_TEMPLATE = """任务：为下文抽取目录树，用于后续按节切分知识。

优先规则：
1. 若文中已有明确「目录 / Contents / Table of Contents」，按原文目录还原层级与标题。
2. 若无现成目录，根据正文结构自行归纳目录（按论述单元划分，勿过碎）。

输出 JSON 数组（字段固定）：
[
  {{"title": "章节名", "level": 1, "anchor": "该节正文开头的连续原文短句（15-40字，必须可在原文中精确匹配）"}},
  {{"title": "小节名", "level": 2, "anchor": "..."}}
]

约束：
- level 从 1 开始；子节 level = 父节 level + 1
- anchor 必须是原文真实连续片段，用于定位切分点
- 条目按文中出现顺序排列，覆盖主要结构

原文：
{text}
"""


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _assign_levels(node: DocNode, level: int = 0) -> None:
    node.level = level
    for child in node.children:
        _assign_levels(child, level + 1)


def _count_leaves(node: DocNode) -> int:
    if node.is_leaf():
        return 1
    return sum(_count_leaves(c) for c in node.children)


def _fixed_ranges(
    start: int,
    end: int,
    md: str,
    chunk_chars: int,
    overlap: int,
) -> list[tuple[int, int]]:
    overlap = min(overlap, max(0, chunk_chars // 5))
    probe_limit = 200
    ranges: list[tuple[int, int]] = []
    cursor = start
    while cursor < end:
        chunk_end = min(cursor + chunk_chars, end)
        if chunk_end < end:
            probe = md[chunk_end : min(chunk_end + probe_limit, end)]
            nl = probe.find("\n")
            if nl >= 0:
                chunk_end = chunk_end + nl + 1
        ranges.append((cursor, chunk_end))
        if chunk_end >= end:
            break
        cursor = max(chunk_end - overlap, cursor + 1)
    return ranges


def _split_oversized_leaves(node: DocNode, md: str, max_chars: int, overlap: int) -> None:
    if node.is_leaf():
        if (node.end - node.start) <= max_chars:
            return
        chunks = _fixed_ranges(node.start, node.end, md, max_chars, overlap)
        node.children = [
            DocNode(
                node_id=_new_id(),
                title=f"{node.title} ({i + 1})",
                start=s,
                end=e,
            )
            for i, (s, e) in enumerate(chunks)
        ]
        return
    for child in node.children:
        _split_oversized_leaves(child, md, max_chars, overlap)


def _has_explicit_toc_heading(md: str) -> bool:
    return _TOC_HEADING_RE.search(md) is not None


def _build_heading_tree(md: str, doc_id: str, runtime: MragRuntimeSettings) -> Optional[DocTree]:
    """识别原文 Markdown 标题目录并建树。"""
    matches = list(_HEADING_RE.finditer(md))
    # 跳过单独的「目录」标题本身，避免把 TOC 列表当正文树
    content_matches = [
        m for m in matches
        if not re.match(r"^(目录|Contents|Table of Contents|CONTENTS)$", m.group(2).strip(), re.I)
    ]
    if len(content_matches) < _MIN_HEADINGS_FOR_NATIVE_TOC:
        return None

    root = DocNode(node_id=_new_id(), title="ROOT", start=0, end=len(md), level=0)
    stack: list[tuple[int, DocNode]] = [(0, root)]

    for idx, match in enumerate(content_matches):
        level = len(match.group(1))
        title = match.group(2).strip()
        start = match.start()
        end = content_matches[idx + 1].start() if idx + 1 < len(content_matches) else len(md)
        node = DocNode(node_id=_new_id(), title=title, start=start, end=end)

        while stack and stack[-1][0] >= level:
            stack.pop()
        parent = stack[-1][1]
        parent.children.append(node)
        stack.append((level, node))

    if not root.children:
        return None

    _assign_levels(root)
    _split_oversized_leaves(
        root, md, runtime.wiki_leaf_max_chars, runtime.fixed_chunk_overlap_chars
    )
    _assign_levels(root)
    logger.info(
        "原文标题目录建树完成: doc_id=%s headings=%s leaves≈%s explicit_toc=%s",
        doc_id,
        len(content_matches),
        _count_leaves(root),
        _has_explicit_toc_heading(md),
    )
    return DocTree(doc_id=doc_id, source_md=md, root=root, total_chars=len(md))


def _build_fixed_tree(md: str, doc_id: str, runtime: MragRuntimeSettings) -> DocTree:
    root = DocNode(node_id=_new_id(), title="ROOT", start=0, end=len(md), level=0)
    ranges = _fixed_ranges(
        0,
        len(md),
        md,
        runtime.fixed_chunk_chars,
        runtime.fixed_chunk_overlap_chars,
    )
    for index, (start, end) in enumerate(ranges, start=1):
        root.children.append(
            DocNode(
                node_id=_new_id(),
                title=f"Section {index}",
                start=start,
                end=end,
                level=1,
            )
        )
    _assign_levels(root)
    logger.info("定长建树完成: doc_id=%s leaves=%s", doc_id, len(root.children))
    return DocTree(doc_id=doc_id, source_md=md, root=root, total_chars=len(md))


def _parse_toc_json(raw: str) -> list[dict[str, Any]]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    match = _JSON_ARRAY_RE.search(text)
    if not match:
        raise ValueError("LLM 目录输出中未找到 JSON 数组")
    data = json.loads(match.group(0))
    if not isinstance(data, list) or not data:
        raise ValueError("LLM 目录 JSON 为空或非数组")
    items: list[dict[str, Any]] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        anchor = str(row.get("anchor") or "").strip()
        try:
            level = int(row.get("level") or 1)
        except (TypeError, ValueError):
            level = 1
        if not title or not anchor:
            continue
        items.append({"title": title, "level": max(1, level), "anchor": anchor})
    if not items:
        raise ValueError("LLM 目录条目无效")
    return items


def _locate_anchor(md: str, anchor: str, search_from: int) -> int:
    needle = (anchor or "").strip()
    if not needle:
        return -1
    pos = md.find(needle, search_from)
    if pos >= 0:
        return pos
    # 宽松：压缩空白后再找
    compact = re.sub(r"\s+", "", needle)
    if len(compact) < 8:
        return -1
    window = md[search_from:]
    compact_md = re.sub(r"\s+", "", window)
    idx = compact_md.find(compact)
    if idx < 0:
        return -1
    # 映射回原文字符位置（近似）
    seen = 0
    for offset, ch in enumerate(window):
        if not ch.isspace():
            if seen == idx:
                return search_from + offset
            seen += 1
    return -1


def _tree_from_toc_items(
    md: str,
    doc_id: str,
    items: list[dict[str, Any]],
    runtime: MragRuntimeSettings,
) -> DocTree:
    located: list[tuple[str, int, int]] = []
    cursor = 0
    for item in items:
        pos = _locate_anchor(md, str(item["anchor"]), cursor)
        if pos < 0:
            pos = _locate_anchor(md, str(item["anchor"]), 0)
        if pos < 0:
            logger.warning("目录 anchor 未命中，跳过: title=%s", item["title"])
            continue
        located.append((str(item["title"]), int(item["level"]), pos))
        cursor = pos + 1

    if len(located) < 1:
        raise ValueError("目录 anchor 全部未命中原文")

    # 按出现位置排序，相同位置保持原序
    located.sort(key=lambda x: x[2])
    root = DocNode(node_id=_new_id(), title="ROOT", start=0, end=len(md), level=0)
    stack: list[tuple[int, DocNode]] = [(0, root)]

    for idx, (title, level, start) in enumerate(located):
        end = located[idx + 1][2] if idx + 1 < len(located) else len(md)
        node = DocNode(node_id=_new_id(), title=title, start=start, end=max(end, start))
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack[-1][1].children.append(node)
        stack.append((level, node))

    if not root.children:
        raise ValueError("LLM 目录未能生成有效子节点")

    # 正文若在首节之前，并入首节
    first = root.children[0]
    if first.start > 0:
        first.start = 0

    _assign_levels(root)
    _split_oversized_leaves(
        root, md, runtime.wiki_leaf_max_chars, runtime.fixed_chunk_overlap_chars
    )
    _assign_levels(root)
    return DocTree(doc_id=doc_id, source_md=md, root=root, total_chars=len(md))


async def _build_llm_toc_tree(
    md: str,
    doc_id: str,
    llm_client: LlmClient,
    runtime: MragRuntimeSettings,
) -> DocTree:
    prompt = _TOC_PROMPT_TEMPLATE.format(text=md[:_LLM_TOC_MAX_CHARS])
    raw = await llm_client.chat_text(prompt, system=_TOC_SYSTEM_PROMPT)
    items = _parse_toc_json(raw)
    tree = _tree_from_toc_items(md, doc_id, items, runtime)
    logger.info(
        "LLM 目录建树完成: doc_id=%s items=%s leaves≈%s",
        doc_id,
        len(items),
        _count_leaves(tree.root),
    )
    return tree


async def build_doc_tree(
    md_content: str,
    doc_id: str,
    llm_client: LlmClient,
    runtime: MragRuntimeSettings,
) -> DocTree:
    md = md_content or ""
    if not md.strip():
        return _build_fixed_tree(md, doc_id, runtime)

    # 1) 优先识别原文目录（Markdown 标题大纲）
    native = _build_heading_tree(md, doc_id, runtime)
    if native is not None:
        return native

    # 2) 无可用原文目录 → LLM 抽取目录树
    try:
        return await _build_llm_toc_tree(md, doc_id, llm_client, runtime)
    except Exception as exc:
        logger.warning("LLM 目录建树失败，回退定长切分: doc_id=%s err=%s", doc_id, exc)

    # 3) 兜底：定长切分
    return _build_fixed_tree(md, doc_id, runtime)
