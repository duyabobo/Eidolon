import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from models.config import LlmConfig
from models.llm_record import LlmCallRecord, LlmCallRecordSummary
from services import mongo_client

logger = logging.getLogger(__name__)


def new_llm_id() -> str:
    return str(uuid.uuid4())


async def create_record(
    *,
    llm_id: str,
    session_id: str | None,
    question_id: str | None,
    messages: list[dict[str, Any]],
    stream: bool,
    cfg: LlmConfig,
    request_body: dict[str, Any],
) -> LlmCallRecord:
    record = LlmCallRecord(
        llm_id=llm_id,
        session_id=session_id,
        question_id=question_id,
        messages=messages,
        stream=stream,
        model=cfg.model,
        protocol=cfg.protocol,
        base_url=cfg.base_url,
        request_body=request_body,
    )
    await mongo_client.insert_llm_record(record)
    logger.info(
        "LLM 记录已创建: llm_id=%s session=%s question=%s stream=%s",
        llm_id, session_id, question_id, stream,
    )
    return record


async def finalize_record(
    llm_id: str,
    *,
    output: str,
    status: str = "completed",
    error: str | None = None,
    latency_ms: int,
) -> None:
    await mongo_client.update_llm_record(
        llm_id,
        {
            "output": output,
            "status": status,
            "error": error,
            "latency_ms": latency_ms,
            "completed_at": datetime.now(UTC),
        },
    )
    logger.info(
        "LLM 记录已完成: llm_id=%s status=%s latency=%dms output_len=%d",
        llm_id, status, latency_ms, len(output),
    )


async def get_record(llm_id: str) -> LlmCallRecord | None:
    return await mongo_client.get_llm_record(llm_id)


async def list_records(
    *,
    session_id: str | None = None,
    question_id: str | None = None,
    limit: int = 50,
) -> list[LlmCallRecordSummary]:
    return await mongo_client.list_llm_records(
        session_id=session_id,
        question_id=question_id,
        limit=limit,
    )
