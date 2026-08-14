"""Wiki node 落盘路径与引用回填。

引用格式（面向图谱 UI）：
  [[node_id|标题]]  — 本批校验命中
  [[标题]]          — 未命中本批节点，保留原文供阅读，不写 filepath
不再写成 [[标题]](/abs/path)（那是给 pi 读文件的，和图谱跳转冲突）。
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from cm_server.mrag.pipeline.models import WikiNode

logger = logging.getLogger(__name__)

_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9_\u4e00-\u9fff\-]+")
# [[id|title]] 或 [[title]]，并吞掉历史错误产物 [[...]](/path)
_WIKI_REF_RE = re.compile(
    r"\[\[(?:(?P<node_id>[^\]|]+)\|)?(?P<title>[^\]]+)\]\](?:\([^)]*\))?"
)
_EMPTY_REFS = frozenset({"", "无", "（无）", "-"})


def safe_filename(name: str) -> str:
    cleaned = _SAFE_NAME_RE.sub("_", name).strip("_")
    return (cleaned or "node")[:80]


def pi_readable_path(path: Path) -> str:
    """pi read/grep 接受的绝对路径（workspace / USER_FILES 白名单内可用）。"""
    return str(path.resolve())


def _unique_wiki_path(wiki: Path, filename: str, reserved: set[str]) -> Path:
    dest = wiki / filename
    if not dest.exists() and str(dest) not in reserved:
        return dest
    stem = dest.stem
    suffix = dest.suffix
    index = 2
    while True:
        candidate = wiki / f"{stem}_{index}{suffix}"
        key = str(candidate)
        if not candidate.exists() and key not in reserved:
            return candidate
        index += 1


def assign_wiki_paths(
    wiki: Path,
    nodes: list[WikiNode],
    *,
    source_name: str,
    shared_dir: bool,
) -> list[Path]:
    wiki.mkdir(parents=True, exist_ok=True)
    reserved: set[str] = set()
    paths: list[Path] = []
    source_part = safe_filename(Path(source_name).stem or "doc")
    for node in nodes:
        node_part = safe_filename(node.title or node.node_id)
        filename = (
            f"{source_part}__{node_part}.md"
            if shared_dir
            else f"{safe_filename(node.node_id)}.md"
        )
        path = _unique_wiki_path(wiki, filename, reserved)
        reserved.add(str(path))
        paths.append(path)
    return paths


def build_title_node_id_index(nodes: list[WikiNode]) -> dict[str, str]:
    """本批节点：标题 / node_id → node_id（casefold）。"""
    index: dict[str, str] = {}
    for node in nodes:
        node_id = (node.node_id or "").strip()
        if not node_id:
            continue
        index.setdefault(node_id.casefold(), node_id)
        title = (node.title or "").strip()
        if title:
            index.setdefault(title.casefold(), node_id)
    return index


def rewrite_wiki_references(text: str, title_to_node_id: dict[str, str]) -> str:
    """将引用回填为 [[node_id|标题]]；未命中则保留 [[标题]]，去掉 filepath。"""
    raw = (text or "").strip()
    if raw in _EMPTY_REFS:
        return text

    known_ids = {node_id for node_id in title_to_node_id.values()}
    unresolved: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        existing_id = (match.group("node_id") or "").strip()
        title = (match.group("title") or "").strip()
        if not title:
            return match.group(0)

        node_id = title_to_node_id.get(title.casefold(), "")
        if not node_id and existing_id:
            if existing_id in known_ids:
                node_id = existing_id
            else:
                node_id = title_to_node_id.get(existing_id.casefold(), "")

        if node_id:
            return f"[[{node_id}|{title}]]"

        unresolved.append(title)
        return f"[[{title}]]"

    rewritten = _WIKI_REF_RE.sub(_replace, text)
    if unresolved:
        logger.info(
            "Wiki 引用未命中本批节点 count=%s samples=%s",
            len(unresolved),
            unresolved[:8],
        )
    return rewritten


def attach_source_and_refs(
    nodes: list[WikiNode],
    *,
    source_file_path: str,
) -> None:
    """回填 source，并按本批标题把引用写成 [[node_id|标题]]。"""
    title_to_id = build_title_node_id_index(nodes)
    source = source_file_path.strip()
    rewritten_nodes = 0
    for node in nodes:
        if source:
            node.source = source
        before = node.references
        node.references = rewrite_wiki_references(before, title_to_id)
        if node.references != before:
            rewritten_nodes += 1
    logger.info(
        "Wiki 来源/引用已回填 source=%s nodes=%s refs_rewritten=%s title_index=%s",
        source or "-",
        len(nodes),
        rewritten_nodes,
        len(title_to_id),
    )


def write_wiki_nodes(nodes: list[WikiNode], paths: list[Path]) -> None:
    for node, path in zip(nodes, paths):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(node.to_markdown(), encoding="utf-8")
    logger.info("Wiki nodes 已写入 count=%s", len(nodes))
