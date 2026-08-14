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
_MIN_LEAF_CHARS = 80
_FALLBACK_OVERVIEW_CHARS = 240
_FALLBACK_BODY_CHARS = 2400
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_LATIN_RE = re.compile(r"[A-Za-z]")
_EMPTY_TEXT = frozenset({"", "无", "（无）", "-", "None", "none"})

_SYSTEM_PROMPT = (
    "你是知识库 Wiki 编译器。只输出指定 Markdown 结构，"
    "不要前言、不要结语、不要用代码围栏包裹全文。"
)

_LEAF_PROMPT_TEMPLATE = """把下面「原文片段」编译成一条可独立阅读的知识节点。

【语种】全文使用{lang_name}（标题、摘要、详情、引用说明都用这种语言）。

【硬约束】
1. 一级标题必须等于「章节标题」原文，不得改写、不得另起新名。
2. 「摘要」「详情」必须有实质内容，禁止写「无」或留空。
3. 「引用」只能从「候选知识名称」逐字照抄为 [[名称]]；禁止候选外名称、论文题名、外部概念、自引用。
4. 没有可引用的候选时，引用区只写：无
5. 系统会丢弃无法对应到其它知识节点的引用，图谱边 = 引用列表，宁缺毋滥。

【抽取原则】
- 独立性：读这一条就能理解核心命题；前置知识只通过引用给出。
- 完整性：从本片段独特视角提炼，不要整段照抄，也不要空洞套话。
- 推导性：引用写出本知识依赖哪些候选节点，并一句说明关系。

【输出】必须且仅用以下结构（二级标题文字固定）：
# {title}

## 元数据
- type: <concept|method|fact|entity|process|other 之一>

## 摘要
<2-4 句核心命题，不要展开步骤>

## 详情
<自包含说明：定义、机制、要点、例子；可用列表>

## 引用
- [[候选名称]] — 本知识与它的关系

候选知识名称：
{candidate_titles}

原文片段：
{text}
"""

_SYNTHESIS_PROMPT_TEMPLATE = """基于各知识节点的「名称 + 摘要」，写一份文档级综述节点。

【语种】全文使用{lang_name}。

【硬约束】
1. 「摘要」「详情」必须有实质内容，禁止写「无」或留空。
2. 引用的 [[名称]] 必须从下方节点标题逐字照抄；禁止杜撰、禁止自引用。
3. 只引构成综述骨架的关键节点；没有则写：无
4. 系统会丢弃无法对应的引用，图谱边 = 引用列表。

【输出】
# <综述标题>

## 元数据
- type: synthesis

## 摘要
<3-6 句总体图景>

## 详情
<各节点如何拼成全文：核心概念关系、章节视角>

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


def _is_blank_wiki_text(text: str) -> bool:
    return (text or "").strip() in _EMPTY_TEXT


def _first_sentences(text: str, max_chars: int) -> str:
    compact = re.sub(r"\s+", " ", (text or "").strip())
    if not compact:
        return ""
    if len(compact) <= max_chars:
        return compact
    cut = compact[:max_chars]
    for sep in ("。", "！", "？", ". ", "! ", "? "):
        idx = cut.rfind(sep)
        if idx >= max_chars // 3:
            return cut[: idx + len(sep.strip())].strip()
    return cut.rstrip() + "…"


def _fill_empty_sections(node: WikiNode, source_text: str) -> None:
    """LLM 漏写摘要/详情时，用原文切片兜底，避免空节点入库。"""
    raw = (source_text or "").strip()
    if _is_blank_wiki_text(node.overview) and raw:
        node.overview = _first_sentences(raw, _FALLBACK_OVERVIEW_CHARS)
        logger.info("Wiki 摘要为空，已用原文兜底 node=%s", node.node_id)
    if _is_blank_wiki_text(node.body) and raw:
        node.body = raw[:_FALLBACK_BODY_CHARS].strip()
        logger.info("Wiki 详情为空，已用原文兜底 node=%s chars=%s", node.node_id, len(node.body))


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
    leaves = [
        leaf for leaf in tree.iter_leaves()
        if len(tree.slice_text(leaf).strip()) >= _MIN_LEAF_CHARS
    ]
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
        # 硬对齐标题到章节名，保证候选列表 / 引用 / 图谱标题一致
        chapter = title.strip()
        if chapter and (node.title or "").strip() != chapter:
            logger.info(
                "Wiki 标题对齐到章节 leaf=%s llm_title=%s -> %s",
                leaf.node_id,
                node.title,
                chapter,
            )
            node.title = chapter
        _fill_empty_sections(node, text)
        logger.info(
            "Wiki 叶子已编译 leaf=%s title=%s overview_chars=%s body_chars=%s refs=%s",
            leaf.node_id,
            node.title,
            len(node.overview),
            len(node.body),
            "yes" if node.references.strip() and node.references.strip() not in _EMPTY_TEXT else "no",
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
    _fill_empty_sections(synthesis, leaf_summaries)
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
