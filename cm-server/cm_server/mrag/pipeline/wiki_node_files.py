"""Wiki node 落盘路径与引用回填。

引用双写（UI + pi）：
  [[node_id|标题]](wiki/xxx.md)  — 命中本批且有 pi 可读相对路径
  [[node_id|标题]]               — 命中本批但无可达路径
  [[标题]]                       — 未命中本批

括号内路径相对 USER_FILES（如 wiki/a.md）或相对 session workspace（如 uploads/a.pdf）。
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from pi_shared.workspace.constants import (
    SESSION_WORKSPACE_SUBDIR,
    WRITABLE_ROOT,
)
from pi_shared.workspace.paths import user_root

from cm_server.mrag.pipeline.models import WikiNode

logger = logging.getLogger(__name__)

_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9_\u4e00-\u9fff\-]+")
_WIKI_REF_RE = re.compile(
    r"\[\[(?:(?P<node_id>[^\]|]+)\|)?(?P<title>[^\]]+)\]\](?:\([^)]*\))?"
)
_EMPTY_REFS = frozenset({"", "无", "（无）", "-"})


def safe_filename(name: str) -> str:
    cleaned = _SAFE_NAME_RE.sub("_", name).strip("_")
    return (cleaned or "node")[:80]


def pi_readable_path(path: Path) -> str:
    """沙盒内绝对路径（fallback；优先用 to_pi_relative_path）。"""
    return str(path.resolve())


def to_pi_relative_path(
    abs_path: Path,
    *,
    owner_user_id: str | None,
    sandbox_root: str | Path,
) -> str:
    """把绝对路径收成 pi 可读相对路径；无法收则返回空串。

    - users/{uid}/files/... → 相对 USER_FILES（如 wiki/a.md）
    - users/{uid}/sessions/{sid}/workspace/... → 相对 workspace（如 uploads/a.pdf）
    """
    uid = (owner_user_id or "").strip()
    if not uid:
        return ""
    root = Path(sandbox_root)
    target = abs_path.resolve()

    user_files = (user_root(root, uid) / WRITABLE_ROOT).resolve()
    try:
        rel = target.relative_to(user_files)
        return rel.as_posix()
    except ValueError:
        pass

    sessions_root = (user_root(root, uid) / "sessions").resolve()
    try:
        rel = target.relative_to(sessions_root)
    except ValueError:
        return ""
    parts = rel.parts
    # {sid}/workspace/{...}
    if len(parts) >= 2 and parts[1] == SESSION_WORKSPACE_SUBDIR:
        return Path(*parts[2:]).as_posix() if len(parts) > 2 else ""
    return ""


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


def build_title_node_id_index(
    nodes: list[WikiNode],
    *,
    extra_aliases: dict[str, str] | None = None,
) -> dict[str, str]:
    """标题 / node_id / 额外别名（如章节原标题）→ node_id。"""
    index: dict[str, str] = {}
    for node in nodes:
        node_id = (node.node_id or "").strip()
        if not node_id:
            continue
        index.setdefault(node_id.casefold(), node_id)
        title = (node.title or "").strip()
        if title:
            index.setdefault(title.casefold(), node_id)
    if extra_aliases:
        for alias, node_id in extra_aliases.items():
            key = (alias or "").strip()
            nid = (node_id or "").strip()
            if key and nid:
                index.setdefault(key.casefold(), nid)
    return index


def rewrite_wiki_references(
    text: str,
    title_to_node_id: dict[str, str],
    node_id_to_rel_path: dict[str, str],
) -> str:
    """双写：[[node_id|标题]](相对路径) 或 [[node_id|标题]] / [[标题]]。"""
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

        if not node_id:
            unresolved.append(title)
            return f"[[{title}]]"

        rel = (node_id_to_rel_path.get(node_id) or "").strip()
        if rel:
            return f"[[{node_id}|{title}]]({rel})"
        return f"[[{node_id}|{title}]]"

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
    owner_user_id: str | None = None,
    pi_link_paths: list[Path] | None = None,
    sandbox_root: str | Path,
    extra_title_aliases: dict[str, str] | None = None,
) -> None:
    """回填 source（pi 相对路径优先），引用双写 node_id + 相对路径。"""
    title_to_id = build_title_node_id_index(nodes, extra_aliases=extra_title_aliases)
    node_id_to_rel: dict[str, str] = {}
    if pi_link_paths:
        for node, path in zip(nodes, pi_link_paths):
            rel = to_pi_relative_path(
                path, owner_user_id=owner_user_id, sandbox_root=sandbox_root,
            )
            if rel and node.node_id:
                node_id_to_rel[node.node_id] = rel

    source_raw = source_file_path.strip()
    source_rel = ""
    if source_raw:
        source_rel = to_pi_relative_path(
            Path(source_raw), owner_user_id=owner_user_id, sandbox_root=sandbox_root,
        )
    source_for_meta = source_rel or source_raw

    rewritten_nodes = 0
    for node in nodes:
        if source_for_meta:
            node.source = source_for_meta
        before = node.references
        node.references = rewrite_wiki_references(before, title_to_id, node_id_to_rel)
        if node.references != before:
            rewritten_nodes += 1

    logger.info(
        "Wiki 来源/引用已回填 source=%s nodes=%s refs_rewritten=%s pi_paths=%s aliases=%s",
        source_for_meta or "-",
        len(nodes),
        rewritten_nodes,
        len(node_id_to_rel),
        len(extra_title_aliases or {}),
    )


def write_wiki_nodes(nodes: list[WikiNode], paths: list[Path]) -> None:
    for node, path in zip(nodes, paths):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(node.to_markdown(), encoding="utf-8")
    logger.info("Wiki nodes 已写入 count=%s", len(nodes))
