"""Parse 管线：mineru3 → Phase1/2 → original wiki。"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path

from cm_server.admin.constants.knowledge import DOC_STATUS_INDEXED, DOC_STATUS_PROCESSING
from cm_server.mrag import storage
from cm_server.mrag.doc_status import get_document_row, mark_failed, mark_processing, update_document_fields
from cm_server.mrag.llm.client import LlmClient
from cm_server.mrag.parsers.mineru3_client import parse_file_to_markdown
from cm_server.mrag.pipeline.original_nodes import build_and_save_original_nodes
from cm_server.mrag.pipeline.preprocess import build_doc_tree
from cm_server.mrag.settings import MragRuntimeSettings

logger = logging.getLogger(__name__)

_VLM_IMAGE_LIMIT = 20


async def _optional_vlm_enrich(
    md: str,
    images: list[Path],
    doc_id: str,
    llm_client: LlmClient,
    runtime: MragRuntimeSettings,
) -> str:
    if not runtime.vlm_enabled or not images:
        return md

    async def _describe(img: Path) -> str:
        return await llm_client.chat_vision(
            "请用中文简要描述该图片/表格的关键信息，便于检索。",
            img,
        )

    selected = images[:_VLM_IMAGE_LIMIT]
    descriptions = await llm_client.map_bounded(
        selected,
        _describe,
        concurrency=runtime.vlm_max_concurrent,
    )
    parts = [md, "\n\n# 附件视觉理解\n"]
    for img, desc in zip(selected, descriptions):
        if desc:
            parts.append(f"\n### {img.name}\n{desc}\n")
    logger.info("VLM 增强完成: doc_id=%s images=%s", doc_id, len(selected))
    return "".join(parts)


async def run_parse_for_doc(
    kb_id: str,
    doc_id: str,
    llm_client: LlmClient,
    runtime: MragRuntimeSettings,
) -> dict:
    started = time.time()
    row = await get_document_row(doc_id)
    if not row:
        raise RuntimeError(f"文档不存在: {doc_id}")
    if row.get("kb_id") != kb_id:
        raise RuntimeError(f"文档不属于知识库: doc_id={doc_id} kb_id={kb_id}")
    if map_indexed(row):
        logger.info("parse 幂等跳过: doc_id=%s", doc_id)
        return {"doc_id": doc_id, "skipped": True}

    filename = str(row["name"])
    file_path = storage.resolve_original_file(kb_id, doc_id, filename)
    if not file_path.exists():
        msg = f"原件不存在: {file_path}"
        await mark_failed(doc_id, msg)
        raise RuntimeError(msg)

    await mark_processing(doc_id)
    storage.ensure_preprocess_layout(kb_id, doc_id)
    work_dir = storage.preprocess_dir(kb_id, doc_id)

    try:
        # 同步 httpx + sleep 轮询，必须放到线程，否则会堵死整个 cm-server 事件循环
        md, images = await asyncio.to_thread(parse_file_to_markdown, file_path, work_dir, runtime)
        md = await _optional_vlm_enrich(md, images, doc_id, llm_client, runtime)

        phase1 = storage.phase1_path(kb_id, doc_id)
        phase1.write_text(md, encoding="utf-8")
        logger.info("Phase1 落盘: doc_id=%s chars=%s", doc_id, len(md))

        tree = await build_doc_tree(md, doc_id, llm_client, runtime)
        phase2 = storage.phase2_path(kb_id, doc_id)
        phase2.write_text(
            json.dumps(tree.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        build_and_save_original_nodes(tree, kb_id, doc_id)

        # parse 完成但仍需 understand；对外仍为 processing
        await update_document_fields(
            doc_id,
            status=DOC_STATUS_PROCESSING,
            wiki_compiled=False,
            error_message="",
        )
        elapsed = time.time() - started
        logger.info("parse 完成: doc_id=%s elapsed=%.1fs", doc_id, elapsed)
        return {"doc_id": doc_id, "elapsed": elapsed}
    except Exception as exc:
        logger.exception("parse 失败: doc_id=%s", doc_id)
        await mark_failed(doc_id, str(exc))
        raise


def map_indexed(row: dict) -> bool:
    return bool(row.get("wiki_compiled")) or str(row.get("status")) == DOC_STATUS_INDEXED
