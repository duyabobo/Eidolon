"""Wiki node 落盘路径与引用回填。

引用落盘格式（pi 可 read）：
  [[node_id|标题]](wiki/xxx.md)

未命中本批 node_id 的引用一律丢弃。括号内路径相对 USER_FILES（wiki/a.md）。
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from pi_shared.workspace.constants import (
    SESSION_WORKSPACE_SUBDIR,
    USER_WIKI_SUBDIR,
    WRITABLE_ROOT,
)
from pi_shared.workspace.paths import user_root

from cm_server.mrag.pipeline.models import WikiNode

logger = logging.getLogger(__name__)

_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9_\u4e00-\u9fff\-]+")
_WIKI_REF_RE = re.compile(
    r"\[\[(?:(?P<node_id>[^\]|]+)\|)?(?P<title>[^\]]+)\]\](?:\([^)]*\))?"
)
_EMPTY_REFS = frozenset({"", "无", "（无）", "-", "None", "none"})


_LIST_PREFIX_RE = re.compile(r"^[-*•]\s+")
_REF_DESC_RE = re.compile(r"^(?:—|–)\s+(.+)$")


def iter_wiki_refs(references: str) -> list[tuple[str, str, str]]:
    """从引用块提取 (target_node_id, 标题, 关系说明)。

    node_id 可能为空（旧产物只有 [[标题]]），调用方按标题回填。
    """
    results: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for line in (references or "").splitlines():
        bare = _LIST_PREFIX_RE.sub("", line.strip()).strip()
        if not bare or bare in _EMPTY_REFS:
            continue
        match = _WIKI_REF_RE.search(bare)
        if not match:
            continue
        node_id = (match.group("node_id") or "").strip()
        title = (match.group("title") or "").strip()
        rest = bare[match.end():].strip()
        desc_match = _REF_DESC_RE.match(rest) if rest else None
        description = desc_match.group(1).strip() if desc_match else ""
        dedupe = (node_id or title).casefold()
        if not dedupe or dedupe in seen:
            continue
        seen.add(dedupe)
        results.append((node_id, title, description))
    return results


def iter_wiki_ref_node_ids(references: str) -> list[str]:
    """从引用块提取已双写的 target node_id（仅含 [[id|标题]] 中的 id）。"""
    return [node_id for node_id, _title, _desc in iter_wiki_refs(references) if node_id]


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
    raw = str(abs_path).strip()
    if not raw:
        return ""
    uid = (owner_user_id or "").strip()
    target = Path(raw)
    try:
        target = target.resolve()
    except OSError:
        pass

    if uid:
        root = Path(sandbox_root)
        user_files = (user_root(root, uid) / WRITABLE_ROOT).resolve()
        try:
            return target.relative_to(user_files).as_posix()
        except ValueError:
            pass

        sessions_root = (user_root(root, uid) / "sessions").resolve()
        try:
            rel = target.relative_to(sessions_root)
            parts = rel.parts
            if len(parts) >= 2 and parts[1] == SESSION_WORKSPACE_SUBDIR:
                return Path(*parts[2:]).as_posix() if len(parts) > 2 else ""
        except ValueError:
            pass

    posix = target.as_posix()
    files_marker = f"/{WRITABLE_ROOT}/"
    if files_marker in posix:
        return posix.split(files_marker, 1)[1]
    workspace_marker = f"/{SESSION_WORKSPACE_SUBDIR}/"
    if workspace_marker in posix:
        return posix.split(workspace_marker, 1)[1]
    return ""


def wiki_pi_rel_path(path: Path) -> str:
    """USER_FILES 下 wiki 文件的 pi 相对路径，固定 wiki/文件名.md。"""
    name = path.name.strip()
    if not name:
        return ""
    return f"{USER_WIKI_SUBDIR}/{name}"


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


_DESC_ONLY_RE = re.compile(r"^(?:—|–|-)\s+(.+)$")
_DESC_PREFIX_RE = re.compile(r"^(?:—|–)\s+(.+)$")
_PLAIN_REF_RE = re.compile(r"^(.+?)\s*(?:—|–)\s+(.+)$")


def rewrite_wiki_references(
    text: str,
    title_to_node_id: dict[str, str],
    node_id_to_rel_path: dict[str, str],
    *,
    node_id_to_title: dict[str, str] | None = None,
    exclude_node_id: str = "",
) -> str:
    """硬校验引用：只保留能落到本批 node_id 的条目，双写 [[id|标题]](相对路径)。

    未命中的 [[名称]] / 纯文本引用一律丢弃，保证落盘引用与图谱可跳转集合一致。
    """
    raw = (text or "").strip()
    if raw in _EMPTY_REFS:
        return "无"

    known_ids = {node_id for node_id in title_to_node_id.values()}
    id_to_title = node_id_to_title or {}
    exclude = (exclude_node_id or "").strip()
    kept: list[str] = []
    dropped: list[str] = []

    def _resolve(title: str, existing_id: str = "") -> str:
        node_id = title_to_node_id.get(title.casefold(), "")
        if not node_id and existing_id:
            if existing_id in known_ids:
                node_id = existing_id
            else:
                node_id = title_to_node_id.get(existing_id.casefold(), "")
        if node_id and exclude and node_id == exclude:
            return ""
        return node_id

    seen_ids: set[str] = set()

    def _emit(node_id: str, fallback_title: str, description: str) -> None:
        if node_id in seen_ids:
            return
        seen_ids.add(node_id)
        title = (id_to_title.get(node_id) or fallback_title or node_id).strip()
        rel = (node_id_to_rel_path.get(node_id) or "").strip()
        if not rel:
            rel = wiki_pi_rel_path(Path(f"{safe_filename(node_id)}.md"))
        link = f"[[{node_id}|{title}]]({rel})"
        if description:
            kept.append(f"- {link} — {description}")
        else:
            kept.append(f"- {link}")

    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    pending_title = ""
    pending_id = ""

    for line in lines:
        bare = _LIST_PREFIX_RE.sub("", line).strip()
        desc_only = _DESC_ONLY_RE.match(bare)
        if desc_only and pending_title:
            node_id = _resolve(pending_title, pending_id)
            if node_id:
                _emit(node_id, pending_title, desc_only.group(1).strip())
            else:
                dropped.append(pending_title)
            pending_title, pending_id = "", ""
            continue

        link_match = _WIKI_REF_RE.search(bare)
        if link_match:
            existing_id = (link_match.group("node_id") or "").strip()
            title = (link_match.group("title") or "").strip()
            rest = bare[link_match.end():].strip()
            desc_match = _DESC_PREFIX_RE.match(rest) if rest else None
            description = desc_match.group(1).strip() if desc_match else ""
            if not description and not rest:
                pending_title, pending_id = title, existing_id
                continue
            node_id = _resolve(title, existing_id)
            if node_id:
                _emit(node_id, title, description)
            else:
                dropped.append(title)
            pending_title, pending_id = "", ""
            continue

        plain = _PLAIN_REF_RE.match(bare)
        if plain:
            title = plain.group(1).strip()
            description = plain.group(2).strip()
            node_id = _resolve(title)
            if node_id:
                _emit(node_id, title, description)
            else:
                dropped.append(title)
            pending_title, pending_id = "", ""
            continue

        if bare and bare not in _EMPTY_REFS:
            pending_title, pending_id = bare, ""

    if pending_title:
        node_id = _resolve(pending_title, pending_id)
        if node_id:
            _emit(node_id, pending_title, "")
        else:
            dropped.append(pending_title)

    if dropped:
        logger.info(
            "Wiki 引用硬过滤未命中 count=%s samples=%s",
            len(dropped),
            dropped[:8],
        )
    return "\n".join(kept) if kept else "无"


def attach_source_and_refs(
    nodes: list[WikiNode],
    *,
    source_file_path: str,
    owner_user_id: str | None = None,
    pi_link_paths: list[Path] | None = None,
    sandbox_root: str | Path,
    extra_title_aliases: dict[str, str] | None = None,
) -> None:
    """回填 source（pi 相对路径优先），引用硬校验后双写 node_id + 相对路径。"""
    title_to_id = build_title_node_id_index(nodes, extra_aliases=extra_title_aliases)
    node_id_to_title = {
        (n.node_id or "").strip(): (n.title or n.node_id or "").strip()
        for n in nodes
        if (n.node_id or "").strip()
    }
    node_id_to_rel: dict[str, str] = {}
    for node, path in zip(nodes, pi_link_paths or []):
        if not node.node_id:
            continue
        rel = to_pi_relative_path(
            path, owner_user_id=owner_user_id, sandbox_root=sandbox_root,
        )
        node_id_to_rel[node.node_id] = rel or wiki_pi_rel_path(path)
    for node in nodes:
        if node.node_id and node.node_id not in node_id_to_rel:
            node_id_to_rel[node.node_id] = wiki_pi_rel_path(Path(f"{safe_filename(node.node_id)}.md"))

    source_raw = source_file_path.strip()
    source_rel = ""
    if source_raw:
        source_rel = to_pi_relative_path(
            Path(source_raw), owner_user_id=owner_user_id, sandbox_root=sandbox_root,
        )
        if not source_rel:
            logger.warning("Wiki 源文件无法收成 pi 相对路径 source=%s", source_raw)
    source_for_meta = source_rel

    rewritten_nodes = 0
    for node in nodes:
        node.source = source_for_meta
        before = node.references
        node.references = rewrite_wiki_references(
            before,
            title_to_id,
            node_id_to_rel,
            node_id_to_title=node_id_to_title,
            exclude_node_id=node.node_id,
        )
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
