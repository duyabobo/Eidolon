"""管线内部数据结构。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from cm_server.mrag.pipeline.wiki_markdown import WikiNodeDocument


@dataclass
class DocNode:
    node_id: str
    title: str
    start: int
    end: int
    children: list["DocNode"] = field(default_factory=list)
    level: int = 0

    def is_leaf(self) -> bool:
        return not self.children

    def to_dict(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "title": self.title,
            "start": self.start,
            "end": self.end,
            "level": self.level,
            "children": [c.to_dict() for c in self.children],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DocNode":
        return cls(
            node_id=data["node_id"],
            title=data.get("title", ""),
            start=int(data.get("start", 0)),
            end=int(data.get("end", 0)),
            level=int(data.get("level", 0)),
            children=[cls.from_dict(c) for c in data.get("children") or []],
        )


@dataclass
class DocTree:
    doc_id: str
    source_md: str
    root: DocNode
    total_chars: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "source_md": self.source_md,
            "total_chars": self.total_chars,
            "root": self.root.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DocTree":
        return cls(
            doc_id=data["doc_id"],
            source_md=data.get("source_md", ""),
            total_chars=int(data.get("total_chars", 0)),
            root=DocNode.from_dict(data["root"]),
        )

    def iter_leaves(self) -> list[DocNode]:
        leaves: list[DocNode] = []

        def _walk(node: DocNode) -> None:
            if node.is_leaf():
                leaves.append(node)
                return
            for child in node.children:
                _walk(child)

        for child in self.root.children:
            _walk(child)
        if not leaves and self.root.is_leaf():
            leaves.append(self.root)
        return leaves

    def slice_text(self, node: DocNode) -> str:
        return self.source_md[node.start : node.end]


@dataclass
class WikiNode:
    """编译期知识节点：四段结构（元数据 / 摘要 / 详情 / 引用）。"""

    node_id: str
    title: str
    node_type: str
    overview: str = ""
    body: str = ""
    references: str = ""
    source: str = ""
    source_date: str = ""
    created_at: str = ""
    source_leaf_id: Optional[str] = None

    def to_document(self) -> WikiNodeDocument:
        return WikiNodeDocument(
            node_id=self.node_id,
            title=self.title,
            node_type=self.node_type,
            source=self.source,
            source_date=self.source_date,
            created_at=self.created_at,
            source_leaf_id=self.source_leaf_id or "",
            overview=self.overview,
            body=self.body,
            references=self.references,
        )

    def to_markdown(self) -> str:
        return self.to_document().to_markdown()

    @classmethod
    def from_document(cls, doc: WikiNodeDocument) -> "WikiNode":
        return cls(
            node_id=doc.node_id,
            title=doc.title,
            node_type=doc.node_type,
            overview=doc.overview,
            body=doc.body,
            references=doc.references,
            source=doc.source,
            source_date=doc.source_date,
            created_at=doc.created_at,
            source_leaf_id=doc.source_leaf_id or None,
        )
