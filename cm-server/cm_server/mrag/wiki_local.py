"""从本地 wiki/*.md 构建图谱与节点详情。

图谱只展示编译知识节点：
- compiled_{tree_id} / compiled_doc_synthesis
- 边只来自各节点「引用」区（与详情引用列表一致）

original_*.md 仅作编译失败时的详情兜底，不进图谱。
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from fastapi import HTTPException, status

from cm_server.admin.constants.knowledge import DOC_STATUS_INDEXED, SYNTHESIS_NODE_ID
from cm_server.admin.models.wiki import (
    WikiDocumentGraphResponse,
    WikiGraphEdge,
    WikiGraphNode,
    WikiNodeDetailResponse,
    WikiNodeItem,
)
from cm_server.mrag import storage
from cm_server.mrag.doc_status import get_document_row, map_public_status
from cm_server.mrag.pipeline.models import DocNode, DocTree
from cm_server.mrag.pipeline.wiki_node_files import iter_wiki_refs, safe_filename
from cm_server.mrag.pipeline.wiki_markdown import parse_wiki_markdown

logger = logging.getLogger(__name__)

_SECTION_PREFIX = "section_"
_COMPILED_PREFIX = "compiled_"
_ORIGINAL_PREFIX = "original_"


def _require_indexed_doc(doc_id: str, row: dict | None) -> dict:
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    if map_public_status(row) != DOC_STATUS_INDEXED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="文档尚未完成 Wiki 编译，无法查看图谱",
        )
    return row


def _section_graph_id(tree_node_id: str) -> str:
    return f"{_SECTION_PREFIX}{tree_node_id}"


def _compiled_graph_id(tree_node_id: str) -> str:
    return f"{_COMPILED_PREFIX}{tree_node_id}"


def _graph_node_id(node: DocNode) -> str:
    if node.is_leaf():
        return _compiled_graph_id(node.node_id)
    return _section_graph_id(node.node_id)


def _append_node(
    nodes: list[WikiGraphNode],
    *,
    node_id: str,
    title: str,
    node_type: str,
    kb_id: str,
    tree_node_id: str | None,
    max_nodes: int,
) -> bool:
    if len(nodes) >= max_nodes:
        return False
    nodes.append(
        WikiGraphNode(
            node_id=node_id,
            title=title,
            type=node_type,
            source="doctree" if node_type == "section" else "wiki",
            tree_node_id=tree_node_id,
            knowledge_id=kb_id,
        )
    )
    return True


def _is_knowledge_wiki_stem(stem: str) -> bool:
    """图谱只收编译知识节点，排除 original / section。"""
    if not stem or stem.startswith(_ORIGINAL_PREFIX) or stem.startswith(_SECTION_PREFIX):
        return False
    return stem.startswith(_COMPILED_PREFIX) or stem == SYNTHESIS_NODE_ID


def _load_compiled_graph_nodes(
    kb_id: str,
    doc_id: str,
    *,
    max_nodes: int,
) -> list[WikiGraphNode]:
    """从文档 wiki 目录扫描 compiled_*.md，不走文档树、不展示 original。"""
    nodes: list[WikiGraphNode] = []
    wiki = storage.wiki_dir(kb_id, doc_id)
    if not wiki.exists():
        return nodes

    for path in sorted(wiki.glob("*.md")):
        stem = path.stem
        if not _is_knowledge_wiki_stem(stem):
            continue
        try:
            doc = parse_wiki_markdown(path.read_text(encoding="utf-8"), fallback_id=stem)
        except OSError:
            continue
        node_type = (doc.node_type or "").strip()
        if node_type.lower() == "original":
            continue
        if not node_type:
            node_type = "synthesis" if stem == SYNTHESIS_NODE_ID else "compiled"
        tree_id = _tree_id_from_graph_id(stem)
        if not _append_node(
            nodes,
            node_id=stem,
            title=(doc.title or stem).strip(),
            node_type=node_type,
            kb_id=kb_id,
            tree_node_id=doc.source_leaf_id or tree_id or "",
            max_nodes=max_nodes,
        ):
            break
    return nodes


def _append_reference_edges(
    kb_id: str,
    doc_id: str,
    nodes: list[WikiGraphNode],
    edges: list[WikiGraphEdge],
) -> int:
    """只按落盘「引用」建边，与详情引用列表一一对应。"""
    known = {n.node_id for n in nodes}
    title_to_id = {n.title.strip().casefold(): n.node_id for n in nodes if n.title.strip()}
    existing = {(e.source_id, e.target_id) for e in edges}
    added = 0
    for node in nodes:
        nid = node.node_id
        if not _is_knowledge_wiki_stem(nid):
            continue
        path = _resolve_wiki_path(kb_id, doc_id, nid)
        if path is None:
            continue
        try:
            doc = parse_wiki_markdown(path.read_text(encoding="utf-8"), fallback_id=nid)
        except OSError:
            continue
        for target_id, title, description in iter_wiki_refs(doc.references or ""):
            if target_id not in known:
                target_id = title_to_id.get(title.casefold(), "")
            if not target_id or target_id not in known or target_id == nid:
                continue
            key = (nid, target_id)
            if key in existing:
                continue
            edges.append(
                WikiGraphEdge(
                    source_id=nid,
                    target_id=target_id,
                    description=description or "引用",
                    source_doc_id=doc_id,
                )
            )
            existing.add(key)
            added += 1
    return added


def _resolve_wiki_path(kb_id: str, doc_id: str, node_id: str) -> Path | None:
    wiki = storage.wiki_dir(kb_id, doc_id)
    if not wiki.exists():
        return None
    candidates = [
        wiki / f"{safe_filename(node_id)}.md",
        wiki / f"{node_id}.md",
    ]
    for path in candidates:
        if path.exists():
            return path
    return None


def _parse_wiki_markdown(text: str, fallback_id: str) -> WikiNodeItem:
    doc = parse_wiki_markdown(text, fallback_id=fallback_id)
    return WikiNodeItem(
        node_id=doc.node_id or fallback_id,
        title=doc.title,
        type=doc.node_type,
        source=doc.source or "local_wiki",
        source_date=doc.source_date,
        tree_node_id=doc.source_leaf_id,
        overview=doc.overview,
        body=doc.body,
        references=doc.references,
        created_at=doc.created_at,
        metadata={
            "title": doc.title,
            "type": doc.node_type,
            "source": doc.source,
            "source_date": doc.source_date,
            **doc.extra_meta,
        },
    )


def _find_tree_node(root: DocNode, tree_node_id: str) -> DocNode | None:
    if root.node_id == tree_node_id:
        return root
    for child in root.children:
        found = _find_tree_node(child, tree_node_id)
        if found is not None:
            return found
    return None


def _tree_id_from_graph_id(node_id: str) -> str | None:
    """从图谱/请求 id 还原 phase2 树节点 id；无法识别则返回 None。"""
    raw = (node_id or "").strip()
    if not raw:
        return None
    for prefix in (_SECTION_PREFIX, _COMPILED_PREFIX, _ORIGINAL_PREFIX):
        if raw.startswith(prefix):
            return raw[len(prefix) :]
    return None


def _detail_from_wiki(kb_id: str, doc_id: str, node_id: str) -> WikiNodeItem | None:
    path = _resolve_wiki_path(kb_id, doc_id, node_id)
    if path is None and node_id.startswith(_SECTION_PREFIX):
        return None
    if path is None:
        tree_id = _tree_id_from_graph_id(node_id)
        if tree_id and not node_id.startswith(_ORIGINAL_PREFIX):
            # 图谱叶子 id 为 compiled_*：只找文档 wiki 下的 compiled，不回退 original
            path = _resolve_wiki_path(kb_id, doc_id, f"{_COMPILED_PREFIX}{tree_id}")
        elif tree_id and node_id.startswith(_ORIGINAL_PREFIX):
            path = _resolve_wiki_path(kb_id, doc_id, f"{_ORIGINAL_PREFIX}{tree_id}")
    if path is None:
        return None
    item = _parse_wiki_markdown(path.read_text(encoding="utf-8"), node_id)
    item.knowledge_id = kb_id
    item.source_doc_id = doc_id
    if (
        not node_id.startswith(_ORIGINAL_PREFIX)
        and not (item.overview or "").strip()
        and not (item.body or "").strip()
    ):
        _fill_detail_from_original(item, kb_id, doc_id)
    return item


def _fill_detail_from_original(item: WikiNodeItem, kb_id: str, doc_id: str) -> None:
    """编译节点摘要/详情都空时，回退 original 叶子正文，避免「暂无摘要与详情」。"""
    tree_id = (item.tree_node_id or "").strip() or (_tree_id_from_graph_id(item.node_id) or "")
    if not tree_id:
        return
    path = _resolve_wiki_path(kb_id, doc_id, f"{_ORIGINAL_PREFIX}{tree_id}")
    if path is None:
        return
    original = _parse_wiki_markdown(path.read_text(encoding="utf-8"), f"{_ORIGINAL_PREFIX}{tree_id}")
    if not (original.body or "").strip():
        return
    item.body = original.body
    item.overview = original.overview or original.body[:240].strip()
    logger.info(
        "Wiki 详情用 original 兜底 doc_id=%s node_id=%s chars=%s",
        doc_id,
        item.node_id,
        len(item.body),
    )


def _detail_from_section(kb_id: str, doc_id: str, node_id: str) -> WikiNodeItem | None:
    """章节节点没有 wiki 文件：内容源是 phase2 文档树切片。"""
    phase2 = storage.phase2_path(kb_id, doc_id)
    if not phase2.exists():
        return None
    tree = DocTree.from_dict(json.loads(phase2.read_text(encoding="utf-8")))
    tree_node_id = _tree_id_from_graph_id(node_id)
    if not tree_node_id:
        return None
    found = _find_tree_node(tree.root, tree_node_id)
    if found is None or found.title == "ROOT":
        return None
    # 叶子应走 wiki；这里只服务非叶子章节
    if found.is_leaf():
        return None
    body = tree.slice_text(found).strip()
    if not body and found.children:
        child_lines = [f"- {child.title}" for child in found.children if (child.title or "").strip()]
        body = "本章包含以下小节：\n" + "\n".join(child_lines) if child_lines else ""
    graph_id = _graph_node_id(found)
    return WikiNodeItem(
        node_id=graph_id,
        title=found.title or graph_id,
        type="section",
        source="doctree",
        source_doc_id=doc_id,
        knowledge_id=kb_id,
        tree_node_id=found.node_id,
        overview="",
        body=body,
        references="",
        metadata={
            "title": found.title or graph_id,
            "type": "section",
            "source": "doctree",
        },
    )


def _iter_candidate_docs(kb_ids: list[str], doc_id: str | None) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    if doc_id:
        if kb_ids:
            for kb_id in kb_ids:
                if storage.doc_dir(kb_id, doc_id).exists():
                    pairs.append((kb_id, doc_id))
                    return pairs
        # 未带 kb 时，在 knowledge 根下定位该 doc
        root = storage.knowledge_root()
        if root.exists():
            for kb_dir in root.iterdir():
                if kb_dir.is_dir() and (kb_dir / doc_id).is_dir():
                    pairs.append((kb_dir.name, doc_id))
                    return pairs
        return pairs

    for kb_id in kb_ids:
        docs_root = storage.knowledge_root() / kb_id
        if not docs_root.exists():
            continue
        for doc_dir in docs_root.iterdir():
            if doc_dir.is_dir():
                pairs.append((kb_id, doc_dir.name))
    return pairs


async def graph_by_doc(
    doc_id: str,
    *,
    max_nodes: int = 500,
) -> WikiDocumentGraphResponse:
    started = time.time()
    row = _require_indexed_doc(doc_id, await get_document_row(doc_id))
    kb_id = str(row["kb_id"])

    nodes = _load_compiled_graph_nodes(kb_id, doc_id, max_nodes=max_nodes)
    edges: list[WikiGraphEdge] = []
    ref_edges = _append_reference_edges(kb_id, doc_id, nodes, edges)
    took_ms = int((time.time() - started) * 1000)
    logger.info(
        "本地 Wiki 图谱 doc_id=%s nodes=%s edges=%s ref_edges=%s took_ms=%s",
        doc_id,
        len(nodes),
        len(edges),
        ref_edges,
        took_ms,
    )
    return WikiDocumentGraphResponse(
        doc_id=doc_id,
        node_count=len(nodes),
        edge_count=len(edges),
        nodes=nodes[:max_nodes],
        edges=edges,
        took_ms=took_ms,
    )


async def node_detail(
    node_id: str,
    *,
    knowledge_ids: list[str] | None = None,
    doc_id: str | None = None,
) -> WikiNodeDetailResponse:
    started = time.time()
    kb_candidates: list[str] = list(knowledge_ids or [])
    if not kb_candidates and not doc_id:
        root = storage.knowledge_root()
        if root.exists():
            kb_candidates = [p.name for p in root.iterdir() if p.is_dir()]

    for kb_id, candidate_doc_id in _iter_candidate_docs(kb_candidates, doc_id):
        # 1) 文档 wiki 目录下的 compiled_*.md 是叶子/综述权威源
        item = _detail_from_wiki(kb_id, candidate_doc_id, node_id)
        if item is not None:
            took_ms = int((time.time() - started) * 1000)
            return WikiNodeDetailResponse(node=item, took_ms=took_ms)

        # 2) section_*：权威源是 phase2 文档树
        item = _detail_from_section(kb_id, candidate_doc_id, node_id)
        if item is not None:
            took_ms = int((time.time() - started) * 1000)
            logger.info(
                "Wiki section 详情 doc_id=%s node_id=%s tree_node_id=%s",
                candidate_doc_id,
                item.node_id,
                item.tree_node_id,
            )
            return WikiNodeDetailResponse(node=item, took_ms=took_ms)

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Wiki 节点不存在: {node_id}")
