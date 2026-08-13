"""从本地 phase2_doctree + wiki/*.md 构建图谱与节点详情。

节点身份约定（与落盘一致）：
- compiled_{tree_id}  → wiki/compiled_*.md（叶子编译结果）
- original_{tree_id}  → wiki/original_*.md（叶子原文）
- compiled_doc_synthesis → 综述
- section_{tree_id}   → 非叶子章节，无独立 md，详情读 phase2 文档树切片
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
from cm_server.mrag.pipeline.wiki_compile import safe_filename
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


def _load_tree(kb_id: str, doc_id: str) -> DocTree:
    phase2 = storage.phase2_path(kb_id, doc_id)
    if not phase2.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="缺少文档树产物（phase2_doctree.json）",
        )
    return DocTree.from_dict(json.loads(phase2.read_text(encoding="utf-8")))


def _graph_node_id(node: DocNode) -> str:
    """图谱 node_id 与详情解析源对齐：叶子走 wiki 文件，章节走文档树。"""
    if node.is_leaf():
        return f"{_COMPILED_PREFIX}{node.node_id}"
    return f"{_SECTION_PREFIX}{node.node_id}"


def _walk_graph(
    node: DocNode,
    *,
    doc_id: str,
    kb_id: str,
    nodes: list[WikiGraphNode],
    edges: list[WikiGraphEdge],
    max_nodes: int,
) -> None:
    if len(nodes) >= max_nodes:
        return
    if node.title != "ROOT":
        nodes.append(
            WikiGraphNode(
                node_id=_graph_node_id(node),
                title=node.title or node.node_id,
                type="compiled" if node.is_leaf() else "section",
                source="doctree",
                tree_node_id=node.node_id,
                knowledge_id=kb_id,
            )
        )
    for child in node.children:
        if node.title != "ROOT":
            edges.append(
                WikiGraphEdge(
                    source_id=_graph_node_id(node),
                    target_id=_graph_node_id(child),
                    description="child",
                    source_doc_id=doc_id,
                )
            )
        _walk_graph(
            child,
            doc_id=doc_id,
            kb_id=kb_id,
            nodes=nodes,
            edges=edges,
            max_nodes=max_nodes,
        )


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
    # 兼容旧图谱：曾用裸 tree_id 表示 section
    return raw


def _detail_from_wiki(kb_id: str, doc_id: str, node_id: str) -> WikiNodeItem | None:
    path = _resolve_wiki_path(kb_id, doc_id, node_id)
    if path is None and node_id.startswith(_SECTION_PREFIX):
        return None
    if path is None:
        # 兼容传入裸 tree_id / 缺前缀的 compiled
        tree_id = _tree_id_from_graph_id(node_id)
        if tree_id:
            path = _resolve_wiki_path(kb_id, doc_id, f"{_COMPILED_PREFIX}{tree_id}")
            if path is None:
                path = _resolve_wiki_path(kb_id, doc_id, f"{_ORIGINAL_PREFIX}{tree_id}")
    if path is None:
        return None
    item = _parse_wiki_markdown(path.read_text(encoding="utf-8"), node_id)
    item.knowledge_id = kb_id
    item.source_doc_id = doc_id
    return item


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
    tree = _load_tree(kb_id, doc_id)

    nodes: list[WikiGraphNode] = []
    edges: list[WikiGraphEdge] = []
    _walk_graph(
        tree.root,
        doc_id=doc_id,
        kb_id=kb_id,
        nodes=nodes,
        edges=edges,
        max_nodes=max_nodes,
    )

    synthesis_path = _resolve_wiki_path(kb_id, doc_id, SYNTHESIS_NODE_ID)
    if synthesis_path and len(nodes) < max_nodes:
        nodes.append(
            WikiGraphNode(
                node_id=SYNTHESIS_NODE_ID,
                title="Document Synthesis",
                type="synthesis",
                source="wiki",
                knowledge_id=kb_id,
            )
        )
        if tree.root.children:
            edges.append(
                WikiGraphEdge(
                    source_id=_graph_node_id(tree.root.children[0]),
                    target_id=SYNTHESIS_NODE_ID,
                    description="synthesis",
                    source_doc_id=doc_id,
                )
            )

    took_ms = int((time.time() - started) * 1000)
    logger.info(
        "本地 Wiki 图谱 doc_id=%s nodes=%s edges=%s took_ms=%s",
        doc_id,
        len(nodes),
        len(edges),
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
        # 1) wiki 文件是叶子/综述的权威源
        item = _detail_from_wiki(kb_id, candidate_doc_id, node_id)
        if item is not None:
            took_ms = int((time.time() - started) * 1000)
            return WikiNodeDetailResponse(node=item, took_ms=took_ms)

        # 2) section_* / 旧版裸 tree_id：权威源是 phase2 文档树
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
