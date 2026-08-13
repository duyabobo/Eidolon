"""按叶子切分 original wiki 节点并落盘。"""
from __future__ import annotations

import logging
from pathlib import Path

from pi_shared import format_iso, now_china

from cm_server.mrag import storage
from cm_server.mrag.pipeline.models import DocTree, WikiNode

logger = logging.getLogger(__name__)

ORIGINAL_PREFIX = "original_"


def build_and_save_original_nodes(tree: DocTree, kb_id: str, doc_id: str) -> list[WikiNode]:
    wiki = storage.wiki_dir(kb_id, doc_id)
    wiki.mkdir(parents=True, exist_ok=True)
    nodes: list[WikiNode] = []
    created_at = format_iso(now_china())

    for leaf in tree.iter_leaves():
        text = tree.slice_text(leaf).strip()
        if not text:
            continue
        title = leaf.title or leaf.node_id
        node = WikiNode(
            node_id=f"{ORIGINAL_PREFIX}{leaf.node_id}",
            title=title,
            node_type="original",
            overview="",
            body=text,
            references="无",
            source=title,
            created_at=created_at,
            source_leaf_id=leaf.node_id,
        )
        path = wiki / f"{node.node_id}.md"
        path.write_text(node.to_markdown(), encoding="utf-8")
        nodes.append(node)

    logger.info("original wiki 落盘: doc_id=%s count=%s dir=%s", doc_id, len(nodes), wiki)
    return nodes


def list_wiki_files(kb_id: str, doc_id: str) -> list[Path]:
    wiki = storage.wiki_dir(kb_id, doc_id)
    if not wiki.exists():
        return []
    return sorted(wiki.glob("*.md"))
