"""进程内 asyncio 知识库任务调度（替代 Celery/Redis）。"""
from __future__ import annotations

import asyncio
import logging
import uuid

from cm_server.admin.services import knowledge_pipeline_store
from cm_server.config import settings
from cm_server.mrag.doc_status import mark_failed, update_document_fields
from cm_server.mrag.llm.client import build_llm_client_from_active_profile
from cm_server.mrag.pipeline.parse import run_parse_for_doc
from cm_server.mrag.pipeline.understand import run_understand_for_doc
from cm_server.mrag.settings import build_runtime_settings

logger = logging.getLogger(__name__)

_semaphore: asyncio.Semaphore | None = None
_running_tasks: set[asyncio.Task] = set()


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(max(1, settings.knowledge_job_concurrency))
    return _semaphore


async def _process_document(kb_id: str, doc_id: str) -> None:
    async with _get_semaphore():
        track_id = uuid.uuid4().hex[:16]
        await update_document_fields(doc_id, track_id=track_id)
        logger.info("知识库任务开始 kb_id=%s doc_id=%s track_id=%s", kb_id, doc_id, track_id)

        try:
            pipeline = await knowledge_pipeline_store.get_pipeline_config()
            if not pipeline.mineru_configured:
                await mark_failed(doc_id, "未配置 mineru-api 地址")
                return
            runtime = build_runtime_settings(pipeline)
            llm_client = await build_llm_client_from_active_profile(runtime)
        except Exception as exc:
            logger.exception("知识库任务准备失败 kb_id=%s doc_id=%s", kb_id, doc_id)
            await mark_failed(doc_id, str(exc))
            return

        try:
            await run_parse_for_doc(kb_id, doc_id, llm_client, runtime)
        except Exception:
            # parse 内部已 mark_failed
            logger.exception("知识库 parse 失败 kb_id=%s doc_id=%s", kb_id, doc_id)
            return

        try:
            await run_understand_for_doc(kb_id, doc_id, llm_client, runtime)
            logger.info("知识库任务完成 kb_id=%s doc_id=%s", kb_id, doc_id)
        except Exception:
            # understand 故意保留 processing + error_message，不回滚为 failed
            logger.exception("知识库 understand 失败 kb_id=%s doc_id=%s", kb_id, doc_id)


def enqueue_document_processing(kb_id: str, doc_id: str) -> None:
    """上传后入队：同进程后台任务，不阻塞请求。"""
    task = asyncio.create_task(
        _process_document(kb_id, doc_id),
        name=f"mrag-process-{doc_id}",
    )
    _running_tasks.add(task)

    def _done(t: asyncio.Task) -> None:
        _running_tasks.discard(t)
        if t.cancelled():
            logger.warning("知识库任务已取消 doc_id=%s", doc_id)
            return
        exc = t.exception()
        if exc is not None:
            logger.error("知识库任务未捕获异常 doc_id=%s err=%s", doc_id, exc)

    task.add_done_callback(_done)
    logger.info("已入队知识库处理 kb_id=%s doc_id=%s", kb_id, doc_id)
