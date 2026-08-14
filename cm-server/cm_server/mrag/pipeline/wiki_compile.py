"""Wiki 编译：按独立性 / 完整性 / 推导性抽取结构化知识节点。"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from pi_shared import format_iso, now_china

from cm_server.admin.config import settings
from cm_server.admin.constants.knowledge import SYNTHESIS_NODE_ID
from cm_server.mrag import storage
from cm_server.mrag.llm.client import LlmClient
from cm_server.mrag.pipeline.models import DocTree, WikiNode
from cm_server.mrag.pipeline.wiki_markdown import extract_structured_wiki
from cm_server.mrag.pipeline.wiki_node_files import (
    assign_wiki_paths,
    attach_source_and_refs,
    write_wiki_nodes,
)
from cm_server.mrag.settings import MragRuntimeSettings

logger = logging.getLogger(__name__)

_LEAF_SUMMARY_MAX_CHARS = 600
_SYNTHESIS_PROMPT_MAX_CHARS = 12000
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_LATIN_RE = re.compile(r"[A-Za-z]")

_SYSTEM_PROMPT = (
    "你是知识库 Wiki 编译助手。严格按用户要求的 Markdown 四级结构输出，"
    "不要输出多余说明，不要用代码围栏包裹全文。"
)

_LEAF_PROMPT_TEMPLATE = """请将下面文档片段提炼为一条「独立知识节点」。

【语种】全文使用{lang_name}撰写（标题、摘要、详情、引用说明均如此）。

【抽取三原则】
1. 独立性：该知识应自解释，不依赖其它知识也能理解和使用；若涉及读者可能不熟悉的前置知识，只能通过「引用」指向候选列表中的节点。
2. 完整性：从本片段的独特视角提炼要点；与其它节点合在一起应覆盖原文信息，避免整段照抄或空洞复述。
3. 推导性：在「引用」中列出支撑本知识的其它知识节点（用 [[名称]]），名称必须从下方「候选知识名称」中照抄；不要引用候选列表之外的论文名、外部概念；若无则写「无」。

【输出格式】必须且仅使用以下结构（一级标题只有标题本身，二级标题固定为这四个）：
# <知识名称，简洁明确>

## 元数据
- type: <concept|method|fact|entity|process|other 之一>
- source: （系统填写源头文件路径，留空即可）

## 摘要
<2-4 句，只概括核心命题，不要展开步骤与细节>

## 详情
<富文本 Markdown：定义、机制、要点、例子等，写得自包含；可用列表/小标题>

## 引用
- [[候选名称]] — 本知识与它的关系
（没有可写「无」）

候选知识名称（引用只能用这些，逐字照抄）：
{candidate_titles}

章节标题：{title}

原文片段：
{text}
"""

_SYNTHESIS_PROMPT_TEMPLATE = """基于以下各知识节点的「名称 + 摘要」，写一份文档级综述知识节点。

【语种】全文使用{lang_name}撰写。

【要求】
- 独立性：综述本身可读；前置知识点通过「引用」给出
- 完整性：覆盖各节点视角，形成对原文的整体图景
- 推导性：引用中列出构成综述的关键知识节点；[[名称]] 必须从下方节点标题中照抄，不要杜撰

【输出格式】
# <综述标题>

## 元数据
- type: synthesis
- source: （系统填写源头文件路径，留空即可）

## 摘要
<3-6 句总体摘要>

## 详情
<Markdown：总体图景、核心概念关系、章节视角如何拼成全文>

## 引用
- [[知识名]] — 在综述中的角色

各节点摘要：
{summaries}
"""


def detect_wiki_language(text: str) -> str:
    """只要出现中文→中文；无中文有英文→英文；否则中文。"""
    sample = text or ""
    if _CJK_RE.search(sample):
        return "zh"
    if _LATIN_RE.search(sample):
        return "en"
    return "zh"


def _lang_name(lang: str) -> str:
    return "中文" if lang == "zh" else "English"


def _format_candidate_titles(titles: list[str], *, exclude: str = "") -> str:
    excl = (exclude or "").strip().casefold()
    lines: list[str] = []
    for title in titles:
        t = (title or "").strip()
        if not t or t.casefold() == excl:
            continue
        lines.append(f"- {t}")
    return "\n".join(lines) if lines else "- （无）"


def _persist_compiled_nodes(
    nodes: list[WikiNode],
    *,
    kb_id: str,
    doc_id: str,
    source_name: str,
    source_file_path: str,
    owner_user_id: str | None,
    extra_title_aliases: dict[str, str] | None = None,
) -> None:
    """文档 wiki 权威落盘；有 owner 时镜像到 USER_FILES/wiki，并双写 pi 相对路径。"""
    doc_wiki = storage.wiki_dir(kb_id, doc_id)
    doc_paths = assign_wiki_paths(
        doc_wiki, nodes, source_name=source_name, shared_dir=False,
    )

    uid = (owner_user_id or "").strip() or None
    pi_paths: list[Path] | None = None
    user_paths: list[Path] | None = None
    if uid:
        user_wiki = storage.user_wiki_dir(uid)
        logger.info("Wiki 镜像到用户公共目录 user=%s dir=%s", uid, user_wiki)
        user_paths = assign_wiki_paths(
            user_wiki, nodes, source_name=source_name, shared_dir=True,
        )
        pi_paths = user_paths

    attach_source_and_refs(
        nodes,
        source_file_path=source_file_path,
        owner_user_id=uid,
        pi_link_paths=pi_paths,
        sandbox_root=settings.sandbox_root,
        extra_title_aliases=extra_title_aliases,
    )
    write_wiki_nodes(nodes, doc_paths)
    if user_paths is not None:
        write_wiki_nodes(nodes, user_paths)


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
        source=source,
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
    *,
    owner_user_id: str | None = None,
    source_name: str = "",
    source_file_path: str = "",
) -> list[WikiNode]:
    leaves = [leaf for leaf in tree.iter_leaves() if tree.slice_text(leaf).strip()]
    created_at = format_iso(now_china())

    sample_text = (tree.source_md or "")[:8000]
    if not sample_text and leaves:
        sample_text = "\n".join(tree.slice_text(leaf)[:2000] for leaf in leaves[:8])
    lang = detect_wiki_language(sample_text)
    lang_name = _lang_name(lang)
    logger.info("Wiki 编译语种 doc_id=%s lang=%s", doc_id, lang)

    leaf_titles = [(leaf.title or leaf.node_id).strip() for leaf in leaves]
    leaf_title_by_id = {
        leaf.node_id: (leaf.title or leaf.node_id).strip()
        for leaf in leaves
    }

    if not leaves:
        empty_title = "空文档" if lang == "zh" else "Empty Document"
        empty_body = "（无可编译正文）" if lang == "zh" else "(No compilable content)"
        fallback = WikiNode(
            node_id="compiled_empty",
            title=empty_title,
            node_type="compiled",
            overview=empty_body,
            body=empty_body,
            references="无" if lang == "zh" else "None",
            source=source_file_path or doc_id,
            created_at=created_at,
        )
        _persist_compiled_nodes(
            [fallback],
            kb_id=kb_id,
            doc_id=doc_id,
            source_name=source_name,
            source_file_path=source_file_path,
            owner_user_id=owner_user_id,
        )
        logger.warning("Wiki 编译跳过：无叶子正文 doc_id=%s", doc_id)
        return [fallback]

    async def _compile_leaf(leaf) -> WikiNode:
        text = tree.slice_text(leaf).strip()
        title = leaf.title or leaf.node_id
        prompt = _LEAF_PROMPT_TEMPLATE.format(
            lang_name=lang_name,
            candidate_titles=_format_candidate_titles(leaf_titles, exclude=title),
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
        lang_name=lang_name,
        summaries=leaf_summaries[:_SYNTHESIS_PROMPT_MAX_CHARS],
    )
    synthesis_text = await llm_client.chat_text(synthesis_prompt, system=_SYSTEM_PROMPT)
    synthesis_fallback = "文档综述" if lang == "zh" else "Document Synthesis"
    synthesis = _build_node_from_llm(
        synthesis_text,
        node_id=SYNTHESIS_NODE_ID,
        fallback_title=synthesis_fallback,
        node_type="synthesis",
        source="document",
        source_leaf_id=None,
        created_at=created_at,
    )
    all_nodes = nodes + [synthesis]

    # 章节原标题 → compiled node_id，便于引用按章节名回填
    aliases: dict[str, str] = {}
    for node in nodes:
        leaf_id = (node.source_leaf_id or "").strip()
        if not leaf_id:
            continue
        section_title = leaf_title_by_id.get(leaf_id, "").strip()
        if section_title:
            aliases[section_title] = node.node_id

    _persist_compiled_nodes(
        all_nodes,
        kb_id=kb_id,
        doc_id=doc_id,
        source_name=source_name,
        source_file_path=source_file_path,
        owner_user_id=owner_user_id,
        extra_title_aliases=aliases,
    )

    log_path = storage.log_dir(kb_id, doc_id) / "phase3_log.txt"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(
        f"compiled_nodes={len(all_nodes)}\nleaves={len(leaves)}\nlang={lang}\n",
        encoding="utf-8",
    )
    logger.info("Wiki 编译完成: doc_id=%s nodes=%s lang=%s", doc_id, len(all_nodes), lang)
    return all_nodes
