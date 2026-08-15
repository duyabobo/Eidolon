"""Wiki 编译：自下而上按四原则抽取结构化知识节点。"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from pi_shared import format_iso, now_china

from cm_server.admin.config import settings
from cm_server.admin.constants.knowledge import SYNTHESIS_NODE_ID
from cm_server.mrag import storage
from cm_server.mrag.llm.client import LlmClient
from cm_server.mrag.pipeline.models import DocNode, DocTree, WikiNode
from cm_server.mrag.pipeline.wiki_markdown import (
    WikiNodeDocument,
    detect_wiki_language,
    extract_structured_wiki,
    extract_structured_wiki_many,
)
from cm_server.mrag.pipeline.wiki_node_files import (
    assign_wiki_paths,
    attach_source_and_refs,
    write_wiki_nodes,
)
from cm_server.mrag.settings import MragRuntimeSettings

logger = logging.getLogger(__name__)

_LEAF_SUMMARY_MAX_CHARS = 600
_PARENT_CONTEXT_MAX_CHARS = 12000
_MIN_LEAF_CHARS = 80
_MAX_NODES_PER_EXTRACT = 8
_FALLBACK_OVERVIEW_CHARS = 240
_FALLBACK_BODY_CHARS = 2400
_EMPTY_TEXT = frozenset({"", "无", "（无）", "-", "None", "none"})

_SYSTEM_PROMPT = (
    "你是知识库 Wiki 编译器。只输出指定 Markdown 结构，"
    "不要前言、不要结语、不要用代码围栏包裹全文。"
)

_PRINCIPLES_BLOCK = """【提取知识四原则】
1. 结构性：每条知识必须包含名称、摘要、详情、引用四段，缺一不可。
2. 自解释：每条知识单独拿出去就能理解，不依赖本章/本节上下文；前置知识只能写在引用里。
3. 完整性：本层抽出的知识从不同视角描述，合在一起应能覆盖本层原文信息，不丢关键命题。
4. 推导性：更复杂的知识用更基础的知识来说明，通过引用组织关系；引用必须是真实知识名。"""

_LEAF_PROMPT_TEMPLATE = """从下面「原文片段」抽取若干条可独立阅读的知识节点。一章可以对应多条知识，不要把整章压成一条综述。

【语种】原文语种为{lang_name}。知识名、摘要、详情、以及「引用」破折号后的关系说明，必须全部使用{lang_name}，禁止中英混写。

{principles}

【数量】本片段约 {text_chars} 字，请抽取 {node_range} 条。
- 每条必须是一个独立知识点（概念 / 方法 / 事实 / 实体 / 过程）。
- 不要输出目录项、过渡句、无实质内容的标题。
- 同一概念不要拆成多条近义重复。

【硬约束】
1. 一级标题用知识自身的准确短名，不要照抄章节名（除非该节确实只有这一个知识点）。
2. 「摘要」「详情」必须有实质内容，禁止写「无」或留空。
3. 「引用」写本知识依赖的其它知识点，格式 [[名称]] — 关系说明。可引用本片段内其它条目。
4. 关系说明必须用{lang_name}（英文原文写 primary evaluation dataset，不要写「该基准是主要评估数据集」）。
5. 禁止论文题名、外部百科概念、自引用。没有可引时写：{empty_ref}
6. 系统会丢弃无法对应到已入库节点的引用，宁缺毋滥。

{output_format}

章节标题（仅供定位，一般不要当知识名）：{section_title}

原文片段：
{text}
"""

_PARENT_PROMPT_TEMPLATE = """这是文档树的上层节点。子树知识已抽出；请按四原则再做一层更全局的抽取，补齐跨节知识、并强化同名知识。

【语种】原文语种为{lang_name}。知识名、摘要、详情、以及「引用」破折号后的关系说明，必须全部使用{lang_name}，禁止中英混写。

{principles}

【本层任务】
1. 阅读「子树已有知识」（按类型分组的名称+摘要）。它们是孩子节点抽出来的局部知识。
2. 结合「本层独有原文」（导语/过渡，不含子节正文）做更全局的抽取。
3. 若某条知识与子树已有知识**同名**：输出更完整、更自解释的强化版（将替换原子知识）。
4. 若子树视角无法覆盖原文：抽出跨节关系、方法/过程、综合性知识作为新节点。
5. 不要把已有知识再缩写成近义重复条（同名强化除外）。

【数量】请抽取 {node_range} 条（含同名强化 + 新增）。

【硬约束】
1. 一级标题用知识短名；同名强化必须与子树知识名逐字一致。
2. 「摘要」「详情」必须有实质内容，禁止写「无」或留空。
3. 引用指向更基础的已有或本层知识，格式 [[名称]] — 关系说明。关系说明必须用{lang_name}。
4. 禁止论文题名、外部百科概念、自引用。没有可引时写：{empty_ref}

{output_format}

本层标题：{section_title}

子树已有知识（按类型）：
{child_knowledge}

本层独有原文：
{exclusive_text}
"""


def _lang_name(lang: str) -> str:
    return "中文" if lang == "zh" else "English"


def empty_ref_label(lang: str) -> str:
    return "无" if lang == "zh" else "None"


def _output_format(lang: str) -> str:
    if lang == "zh":
        ref_example = "- [[知识名]] — 与本条的关系，用中文写"
        ref_empty = "没有可引时写：无"
    else:
        ref_example = "- [[Knowledge name]] — primary evaluation dataset for this method"
        ref_empty = "If none, write: None"
    return (
        "【输出】连续输出多条，两条之间单独一行 --- ；每条结构固定：\n"
        "# <知识短名>\n"
        "\n"
        "## 元数据\n"
        "- type: <concept|method|fact|entity|process|synthesis|other 之一>\n"
        "\n"
        "## 摘要\n"
        "<2-4 句核心命题>\n"
        "\n"
        "## 详情\n"
        "<不限组织格式；层次分明、详略得当、逻辑清晰地解释当前知识>\n"
        "\n"
        "## 引用\n"
        f"{ref_example}\n"
        "（先写知识名即可；系统落盘时回填被引用知识 md 的相对路径，"
        "形如 [[id|知识名]](wiki/xxx.md)，供 pi 直接 read）\n"
        f"{ref_empty}\n"
    )


def _node_range_for_text(text_len: int) -> str:
    if text_len < 400:
        return "1"
    if text_len < 1500:
        return "2-4"
    if text_len < 4000:
        return "3-6"
    return f"4-{_MAX_NODES_PER_EXTRACT}"


def _node_range_for_parent(child_count: int, exclusive_chars: int) -> str:
    base = min(_MAX_NODES_PER_EXTRACT, max(2, child_count + (1 if exclusive_chars > 80 else 0)))
    return f"1-{base}"


def _dedupe_nodes_by_title(nodes: list[WikiNode]) -> list[WikiNode]:
    """同名知识只留内容更完整的一条，保持首次出现顺序。"""
    best: dict[str, tuple[int, WikiNode]] = {}
    order: list[str] = []
    for node in nodes:
        key = (node.title or "").strip().casefold()
        if not key:
            continue
        score = len(node.overview or "") + len(node.body or "")
        if key not in best:
            best[key] = (score, node)
            order.append(key)
            continue
        prev_score, _prev = best[key]
        if score > prev_score:
            best[key] = (score, node)
    kept = [best[key][1] for key in order]
    if len(kept) != len(nodes):
        logger.info("Wiki 同名节点去重 %s -> %s", len(nodes), len(kept))
    return kept


def _merge_strengthen_by_title(
    existing: list[WikiNode],
    incoming: list[WikiNode],
) -> list[WikiNode]:
    """父层同名知识强化替换子层；新名则追加。替换时保留原子 node_id。"""
    by_title = {(n.title or "").strip().casefold(): n for n in existing if (n.title or "").strip()}
    merged = list(existing)
    for new in incoming:
        key = (new.title or "").strip().casefold()
        if not key:
            continue
        old = by_title.get(key)
        if old is None:
            merged.append(new)
            by_title[key] = new
            continue
        logger.info(
            "Wiki 同名强化替换 title=%s old_id=%s new_id=%s",
            new.title,
            old.node_id,
            new.node_id,
        )
        new.node_id = old.node_id
        if old.source_leaf_id and not new.source_leaf_id:
            new.source_leaf_id = old.source_leaf_id
        idx = merged.index(old)
        merged[idx] = new
        by_title[key] = new
    return merged


def _persist_compiled_nodes(
    nodes: list[WikiNode],
    *,
    kb_id: str,
    doc_id: str,
    source_name: str,
    source_file_path: str,
    owner_user_id: str | None,
    extra_title_aliases: dict[str, str] | None = None,
    lang: str = "zh",
) -> None:
    """文档 wiki 权威落盘；有 owner 时镜像到 USER_FILES/wiki，并双写 pi 相对路径。"""
    doc_wiki = storage.wiki_dir(kb_id, doc_id)
    doc_paths = assign_wiki_paths(
        doc_wiki, nodes, source_name=source_name, shared_dir=False,
    )

    uid = (owner_user_id or "").strip() or None
    user_paths: list[Path] | None = None
    if uid:
        user_wiki = storage.user_wiki_dir(uid)
        logger.info("Wiki 镜像到用户公共目录 user=%s dir=%s", uid, user_wiki)
        user_paths = assign_wiki_paths(
            user_wiki, nodes, source_name=source_name, shared_dir=True,
        )

    attach_source_and_refs(
        nodes,
        source_file_path=source_file_path,
        owner_user_id=uid,
        pi_link_paths=user_paths or doc_paths,
        sandbox_root=settings.sandbox_root,
        extra_title_aliases=extra_title_aliases,
        empty_ref_label=empty_ref_label(lang),
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
    raw = (source_text or "").strip()
    if _is_blank_wiki_text(node.overview) and raw:
        node.overview = _first_sentences(raw, _FALLBACK_OVERVIEW_CHARS)
        logger.info("Wiki 摘要为空，已用原文兜底 node=%s", node.node_id)
    if _is_blank_wiki_text(node.body) and raw:
        node.body = raw[:_FALLBACK_BODY_CHARS].strip()
        logger.info("Wiki 详情为空，已用原文兜底 node=%s chars=%s", node.node_id, len(node.body))


def _docs_to_nodes(
    docs: list[WikiNodeDocument],
    *,
    id_prefix: str,
    fallback_title: str,
    source: str,
    source_leaf_id: str | None,
    created_at: str,
    source_text: str,
) -> list[WikiNode]:
    if not docs:
        return []
    multi = len(docs) > 1
    nodes: list[WikiNode] = []
    for index, doc in enumerate(docs, start=1):
        node_id = f"{id_prefix}_{index}" if multi else id_prefix
        node = WikiNode(
            node_id=node_id,
            title=doc.title or fallback_title,
            node_type=doc.node_type or "compiled",
            overview=doc.overview,
            body=doc.body,
            references=doc.references,
            source=source,
            source_date=doc.source_date,
            created_at=doc.created_at or created_at,
            source_leaf_id=source_leaf_id,
        )
        _fill_empty_sections(node, source_text)
        nodes.append(node)
    return _dedupe_nodes_by_title(nodes)


def _parse_extract(
    llm_text: str,
    *,
    id_prefix: str,
    fallback_title: str,
    source: str,
    source_leaf_id: str | None,
    created_at: str,
    source_text: str,
) -> list[WikiNode]:
    docs = extract_structured_wiki_many(
        llm_text,
        fallback_title=fallback_title,
        fallback_id=id_prefix,
    )[:_MAX_NODES_PER_EXTRACT]
    if not docs:
        docs = [
            extract_structured_wiki(
                llm_text,
                fallback_title=fallback_title,
                fallback_id=id_prefix,
            )
        ]
    return _docs_to_nodes(
        docs,
        id_prefix=id_prefix,
        fallback_title=fallback_title,
        source=source,
        source_leaf_id=source_leaf_id,
        created_at=created_at,
        source_text=source_text,
    )


def _format_nodes_by_type(nodes: list[WikiNode], *, max_chars: int) -> str:
    if not nodes:
        return "- （无）"
    groups: dict[str, list[WikiNode]] = {}
    for node in nodes:
        groups.setdefault((node.node_type or "other").strip() or "other", []).append(node)

    parts: list[str] = []
    used = 0
    for typ, items in groups.items():
        header = f"#### {typ}"
        parts.append(header)
        used += len(header)
        for node in items:
            overview = (node.overview or node.body or "")[:_LEAF_SUMMARY_MAX_CHARS]
            block = f"### {node.title}\n{overview}"
            if used + len(block) > max_chars:
                parts.append("…（其余已省略）")
                return "\n\n".join(parts)
            parts.append(block)
            used += len(block)
    return "\n\n".join(parts)


def _parent_exclusive_text(tree: DocTree, node: DocNode) -> str:
    """父节点范围内、不属于任一直接子节点的原文（导语/过渡）。"""
    if node.is_leaf():
        return tree.slice_text(node).strip()
    parts: list[str] = []
    cursor = node.start
    for child in node.children:
        if child.start > cursor:
            gap = tree.source_md[cursor:child.start].strip()
            if gap:
                parts.append(gap)
        cursor = max(cursor, child.end)
    if node.end > cursor:
        tail = tree.source_md[cursor:node.end].strip()
        if tail:
            parts.append(tail)
    return "\n\n".join(parts)


def _section_title(node: DocNode) -> str:
    title = (node.title or "").strip()
    if not title or title == "ROOT":
        return "文档"
    return title


def _assign_root_synthesis(nodes: list[WikiNode]) -> None:
    """根层若抽出 synthesis，固定 id，便于图谱识别。"""
    for node in nodes:
        if (node.node_type or "").strip().lower() != "synthesis":
            continue
        if node.node_id == SYNTHESIS_NODE_ID:
            return
        logger.info("Wiki 根层综述 id 对齐 %s -> %s", node.node_id, SYNTHESIS_NODE_ID)
        node.node_id = SYNTHESIS_NODE_ID
        return


def _empty_fallback(lang: str, source_file_path: str, doc_id: str, created_at: str) -> WikiNode:
    empty_title = "空文档" if lang == "zh" else "Empty Document"
    empty_body = "（无可编译正文）" if lang == "zh" else "(No compilable content)"
    return WikiNode(
        node_id="compiled_empty",
        title=empty_title,
        node_type="compiled",
        overview=empty_body,
        body=empty_body,
        references=empty_ref_label(lang),
        source=source_file_path or doc_id,
        created_at=created_at,
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
    created_at = format_iso(now_china())
    sample_text = (tree.source_md or "")[:8000]
    lang = detect_wiki_language(sample_text)
    lang_name = _lang_name(lang)
    logger.info("Wiki 编译语种 doc_id=%s lang=%s", doc_id, lang)

    async def extract_leaf(node: DocNode) -> list[WikiNode]:
        text = tree.slice_text(node).strip()
        if len(text) < _MIN_LEAF_CHARS:
            logger.info("Wiki 跳过过短叶子 leaf=%s chars=%s", node.node_id, len(text))
            return []
        section = _section_title(node)
        clipped = text[: runtime.wiki_leaf_max_chars]
        prompt = _LEAF_PROMPT_TEMPLATE.format(
            lang_name=lang_name,
            empty_ref=empty_ref_label(lang),
            principles=_PRINCIPLES_BLOCK,
            text_chars=len(text),
            node_range=_node_range_for_text(len(text)),
            output_format=_output_format(lang),
            section_title=section,
            text=clipped,
        )
        llm_text = await llm_client.chat_text(prompt, system=_SYSTEM_PROMPT)
        nodes = _parse_extract(
            llm_text,
            id_prefix=f"compiled_{node.node_id}",
            fallback_title=section,
            source=section,
            source_leaf_id=node.node_id,
            created_at=created_at,
            source_text=text,
        )
        logger.info(
            "Wiki 叶子已抽取 leaf=%s section=%s nodes=%s titles=%s",
            node.node_id,
            section,
            len(nodes),
            [n.title for n in nodes][:8],
        )
        return nodes

    async def extract_parent(node: DocNode, child_nodes: list[WikiNode]) -> list[WikiNode]:
        exclusive = _parent_exclusive_text(tree, node)
        section = _section_title(node)
        child_knowledge = _format_nodes_by_type(
            child_nodes, max_chars=_PARENT_CONTEXT_MAX_CHARS,
        )
        exclusive_clipped = (exclusive or empty_ref_label(lang))[: runtime.wiki_leaf_max_chars]
        prompt = _PARENT_PROMPT_TEMPLATE.format(
            lang_name=lang_name,
            empty_ref=empty_ref_label(lang),
            principles=_PRINCIPLES_BLOCK,
            node_range=_node_range_for_parent(len(node.children), len(exclusive)),
            output_format=_output_format(lang),
            section_title=section,
            child_knowledge=child_knowledge,
            exclusive_text=exclusive_clipped,
        )
        llm_text = await llm_client.chat_text(prompt, system=_SYSTEM_PROMPT)
        prefix = "compiled_root" if (node.title or "") == "ROOT" else f"compiled_{node.node_id}"
        nodes = _parse_extract(
            llm_text,
            id_prefix=prefix,
            fallback_title=section,
            source=section,
            source_leaf_id=None if (node.title or "") == "ROOT" else node.node_id,
            created_at=created_at,
            source_text=exclusive or "\n".join(
                f"{n.title}: {n.overview}" for n in child_nodes[:12]
            ),
        )
        logger.info(
            "Wiki 父层已抽取 node=%s section=%s incoming=%s titles=%s",
            node.node_id,
            section,
            len(nodes),
            [n.title for n in nodes][:8],
        )
        return nodes

    async def extract_subtree(node: DocNode) -> list[WikiNode]:
        if node.is_leaf():
            return await extract_leaf(node)

        child_groups = await llm_client.map_bounded(
            node.children,
            extract_subtree,
            concurrency=runtime.understand_tree_concurrency,
        )
        child_nodes = [item for group in child_groups if group for item in group]
        if not child_nodes and len(tree.slice_text(node).strip()) >= _MIN_LEAF_CHARS:
            return await extract_leaf(node)

        parent_nodes = await extract_parent(node, child_nodes)
        merged = _merge_strengthen_by_title(child_nodes, parent_nodes)
        logger.info(
            "Wiki 子树合并 node=%s children_nodes=%s after_parent=%s",
            node.node_id,
            len(child_nodes),
            len(merged),
        )
        return merged

    start_nodes = tree.root.children if tree.root.children else [tree.root]
    if not start_nodes or not (tree.source_md or "").strip():
        fallback = _empty_fallback(lang, source_file_path, doc_id, created_at)
        _persist_compiled_nodes(
            [fallback],
            kb_id=kb_id,
            doc_id=doc_id,
            source_name=source_name,
            source_file_path=source_file_path,
            owner_user_id=owner_user_id,
            lang=lang,
        )
        logger.warning("Wiki 编译跳过：无正文 doc_id=%s", doc_id)
        return [fallback]

    # 先抽各顶层子树，再对 ROOT 做文档级抽取
    top_groups = await llm_client.map_bounded(
        start_nodes,
        extract_subtree,
        concurrency=runtime.understand_tree_concurrency,
    )
    all_nodes = [item for group in top_groups if group for item in group]
    if tree.root.children:
        root_nodes = await extract_parent(tree.root, all_nodes)
        all_nodes = _merge_strengthen_by_title(all_nodes, root_nodes)
    all_nodes = _dedupe_nodes_by_title(all_nodes)
    _assign_root_synthesis(all_nodes)

    if not all_nodes:
        all_nodes = [_empty_fallback(lang, source_file_path, doc_id, created_at)]

    leaf_title_by_id = {
        leaf.node_id: (leaf.title or "").strip()
        for leaf in tree.iter_leaves()
    }
    aliases: dict[str, str] = {}
    for node in all_nodes:
        leaf_id = (node.source_leaf_id or "").strip()
        section = leaf_title_by_id.get(leaf_id, "")
        if section and section not in aliases:
            aliases[section] = node.node_id

    _persist_compiled_nodes(
        all_nodes,
        kb_id=kb_id,
        doc_id=doc_id,
        source_name=source_name,
        source_file_path=source_file_path,
        owner_user_id=owner_user_id,
        extra_title_aliases=aliases,
        lang=lang,
    )

    log_path = storage.log_dir(kb_id, doc_id) / "phase3_log.txt"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(
        f"compiled_nodes={len(all_nodes)}\nlang={lang}\nbottom_up=1\n",
        encoding="utf-8",
    )
    logger.info("Wiki 自下而上编译完成: doc_id=%s nodes=%s lang=%s", doc_id, len(all_nodes), lang)
    return all_nodes
