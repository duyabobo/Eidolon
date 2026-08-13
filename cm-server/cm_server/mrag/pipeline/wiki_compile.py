"""Wiki 编译：按独立性 / 完整性 / 推导性抽取结构化知识节点。"""
from __future__ import annotations

import logging
import re

from pi_shared import format_iso, now_china

from cm_server.admin.constants.knowledge import SYNTHESIS_NODE_ID
from cm_server.mrag import storage
from cm_server.mrag.llm.client import LlmClient
from cm_server.mrag.pipeline.models import DocTree, WikiNode
from cm_server.mrag.pipeline.wiki_markdown import extract_structured_wiki
from cm_server.mrag.settings import MragRuntimeSettings

logger = logging.getLogger(__name__)

_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9_\u4e00-\u9fff\-]+")
_LEAF_SUMMARY_MAX_CHARS = 600
_SYNTHESIS_PROMPT_MAX_CHARS = 12000

_SYSTEM_PROMPT = (
    "你是知识库 Wiki 编译助手。严格按用户要求的 Markdown 四级结构输出，"
    "不要输出多余说明，不要用代码围栏包裹全文。"
)

_LEAF_PROMPT_TEMPLATE = """请将下面文档片段提炼为一条「独立知识节点」。

【抽取三原则】
1. 独立性：该知识应自解释，不依赖其它知识也能理解和使用；若涉及读者可能不熟悉的前置知识，不要默认读者已知，而是在「引用」中给出，便于按需跳转查看详情。
2. 完整性：从本片段的独特视角提炼要点；与其它节点合在一起应覆盖原文信息，避免整段照抄或空洞复述。
3. 推导性：在「引用」中列出支撑本知识的更基础概念/术语/前置知识（用 [[名称]]），并简述依赖关系；若无则写「无」。

【输出格式】必须且仅使用以下结构（一级标题只有标题本身，二级标题固定为这四个）：
# <知识名称，简洁明确>

## 元数据
- type: <concept|method|fact|entity|process|other 之一>
- source: <来源，填写章节标题或原文定位>

## 摘要
<2-4 句中文，只概括核心命题，不要展开步骤与细节>

## 详情
<富文本 Markdown：定义、机制、要点、例子等，写得自包含；可用列表/小标题>

## 引用
- [[基础概念A]] — 本知识依赖其定义
- [[相关方法B]] — 本知识是其改进/特例
（没有可写「无」）

章节标题：{title}

原文片段：
{text}
"""

_SYNTHESIS_PROMPT_TEMPLATE = """基于以下各知识节点的「名称 + 摘要」，写一份文档级综述知识节点。

【要求】
- 独立性：综述本身可读；前置知识点通过「引用」给出，不默认读者已掌握各章节知识
- 完整性：覆盖各节点视角，形成对原文的整体图景
- 推导性：引用中列出构成综述的关键知识节点（用 [[名称]]）

【输出格式】
# <综述标题>

## 元数据
- type: synthesis
- source: document

## 摘要
<3-6 句总体摘要>

## 详情
<Markdown：总体图景、核心概念关系、章节视角如何拼成全文>

## 引用
- [[知识名]] — 在综述中的角色

各节点摘要：
{summaries}
"""


def safe_filename(name: str) -> str:
    cleaned = _SAFE_NAME_RE.sub("_", name).strip("_")
    return (cleaned or "node")[:80]


def _build_node_from_llm(
    llm_text: str,
    *,
    node_id: str,
    fallback_title: str,
    node_type: str,
    source: str,
    source_leaf_id: str | None,
    created_at: str,
) -> WikiNode:
    doc = extract_structured_wiki(
        llm_text,
        fallback_title=fallback_title,
        fallback_id=node_id,
    )
    return WikiNode(
        node_id=node_id,
        title=doc.title or fallback_title,
        node_type=doc.node_type or node_type,
        overview=doc.overview,
        body=doc.body,
        references=doc.references,
        source=doc.source or source,
        source_date=doc.source_date,
        created_at=doc.created_at or created_at,
        source_leaf_id=source_leaf_id,
    )


async def compile_wiki_to_files(
    tree: DocTree,
    kb_id: str,
    doc_id: str,
    llm_client: LlmClient,
    runtime: MragRuntimeSettings,
) -> list[WikiNode]:
    leaves = [leaf for leaf in tree.iter_leaves() if tree.slice_text(leaf).strip()]
    wiki = storage.wiki_dir(kb_id, doc_id)
    wiki.mkdir(parents=True, exist_ok=True)
    created_at = format_iso(now_china())

    if not leaves:
        fallback = WikiNode(
            node_id="compiled_empty",
            title="Empty Document",
            node_type="compiled",
            overview="文档无可编译正文。",
            body="（无可编译正文）",
            references="无",
            source=doc_id,
            created_at=created_at,
        )
        path = wiki / f"{safe_filename(fallback.node_id)}.md"
        path.write_text(fallback.to_markdown(), encoding="utf-8")
        logger.warning("Wiki 编译跳过：无叶子正文 doc_id=%s", doc_id)
        return [fallback]

    async def _compile_leaf(leaf) -> WikiNode:
        text = tree.slice_text(leaf).strip()
        title = leaf.title or leaf.node_id
        prompt = _LEAF_PROMPT_TEMPLATE.format(
            title=title,
            text=text[: runtime.wiki_leaf_max_chars],
        )
        llm_text = await llm_client.chat_text(prompt, system=_SYSTEM_PROMPT)
        node = _build_node_from_llm(
            llm_text,
            node_id=f"compiled_{leaf.node_id}",
            fallback_title=title,
            node_type="compiled",
            source=title,
            source_leaf_id=leaf.node_id,
            created_at=created_at,
        )
        logger.info(
            "Wiki 叶子已编译 leaf=%s title=%s overview_chars=%s body_chars=%s",
            leaf.node_id,
            node.title,
            len(node.overview),
            len(node.body),
        )
        return node

    # 自下而上：先并发编译全部叶子，再基于叶子摘要生成综述
    compiled = await llm_client.map_bounded(
        leaves,
        _compile_leaf,
        concurrency=runtime.understand_tree_concurrency,
    )
    nodes = [n for n in compiled if n]
    logger.info("Wiki 叶子编译完成 doc_id=%s leaves=%s，开始综述", doc_id, len(nodes))

    leaf_summaries = "\n\n".join(
        f"### {n.title}\n{(n.overview or n.body or '')[:_LEAF_SUMMARY_MAX_CHARS]}"
        for n in nodes
    )
    synthesis_prompt = _SYNTHESIS_PROMPT_TEMPLATE.format(
        summaries=leaf_summaries[:_SYNTHESIS_PROMPT_MAX_CHARS],
    )
    synthesis_text = await llm_client.chat_text(synthesis_prompt, system=_SYSTEM_PROMPT)
    synthesis = _build_node_from_llm(
        synthesis_text,
        node_id=SYNTHESIS_NODE_ID,
        fallback_title="Document Synthesis",
        node_type="synthesis",
        source="document",
        source_leaf_id=None,
        created_at=created_at,
    )
    all_nodes = nodes + [synthesis]

    for node in all_nodes:
        path = wiki / f"{safe_filename(node.node_id)}.md"
        path.write_text(node.to_markdown(), encoding="utf-8")

    log_path = storage.log_dir(kb_id, doc_id) / "phase3_log.txt"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(
        f"compiled_nodes={len(all_nodes)}\nleaves={len(leaves)}\n",
        encoding="utf-8",
    )
    logger.info("Wiki 编译完成: doc_id=%s nodes=%s", doc_id, len(all_nodes))
    return all_nodes
