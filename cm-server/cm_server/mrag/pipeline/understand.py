"""Understand 管线：读 Phase1/2 → LLM 编译 → indexed。"""
from __future__ import annotations

import json
import logging
import time

from cm_server.mrag import storage
from cm_server.mrag.doc_status import get_document_row, mark_indexed, update_document_fields
from cm_server.mrag.llm.client import LlmClient
from cm_server.mrag.pipeline.models import DocTree
from cm_server.mrag.pipeline.wiki_compile import compile_wiki_to_files
from cm_server.mrag.settings import MragRuntimeSettings

logger = logging.getLogger(__name__)


async def run_understand_for_doc(
    kb_id: str,
    doc_id: str,
    llm_client: LlmClient,
    runtime: MragRuntimeSettings,
) -> dict:
    started = time.time()
    row = await get_document_row(doc_id)
    if not row:
        raise RuntimeError(f"文档不存在: {doc_id}")
    if bool(row.get("wiki_compiled")):
        logger.info("understand 幂等跳过: doc_id=%s", doc_id)
        return {"doc_id": doc_id, "skipped": True}

    phase1 = storage.phase1_path(kb_id, doc_id)
    phase2 = storage.phase2_path(kb_id, doc_id)
    if not phase1.exists() or not phase2.exists():
        msg = f"缺少 Phase1/2 产物: phase1={phase1.exists()} phase2={phase2.exists()}"
        await update_document_fields(doc_id, error_message=msg)
        raise RuntimeError(msg)

    try:
        tree = DocTree.from_dict(json.loads(phase2.read_text(encoding="utf-8")))
        if not tree.source_md:
            tree.source_md = phase1.read_text(encoding="utf-8")

        owner_user_id = str(row.get("owner_user_id") or "").strip() or None
        source_name = str(row.get("name") or "")
        source_file_path = str(row.get("source_file_path") or "").strip()
        nodes = await compile_wiki_to_files(
            tree,
            kb_id,
            doc_id,
            llm_client,
            runtime,
            owner_user_id=owner_user_id,
            source_name=source_name,
            source_file_path=source_file_path,
        )
        await mark_indexed(doc_id)
        elapsed = time.time() - started
        logger.info(
            "understand 完成: doc_id=%s nodes=%s elapsed=%.1fs owner=%s",
            doc_id,
            len(nodes),
            elapsed,
            owner_user_id or "-",
        )
        return {"doc_id": doc_id, "nodes": len(nodes), "elapsed": elapsed}
    except Exception as exc:
        # 与现网一致：wiki 编译失败不把文档打回 failed，保留 processing 并写错误
        logger.exception("understand 失败（不回滚 processing）: doc_id=%s", doc_id)
        await update_document_fields(
            doc_id,
            wiki_compiled=False,
            error_message=f"wiki_compile_error: {exc}",
        )
        raise
