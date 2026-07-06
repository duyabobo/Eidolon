import logging
import time
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status

from models.llm_record import LlmCallRecord, LlmCallRecordSummary, ReplayResponse
from routes import proxy as proxy_routes
from services import llm_record_store
from services.llm_config_store import get_effective_config
from services.output_parser import extract_text_from_openai_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/records", tags=["llm-records"])


@router.get("", response_model=list[LlmCallRecordSummary])
async def list_llm_records(
    session_id: str | None = Query(default=None),
    question_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> list:
    return await llm_record_store.list_records(
        session_id=session_id,
        question_id=question_id,
        limit=limit,
    )


@router.get("/{llm_id}", response_model=LlmCallRecord)
async def get_llm_record(llm_id: str) -> LlmCallRecord:
    record = await llm_record_store.get_record(llm_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LLM 记录不存在")
    return record


@router.post("/{llm_id}/replay", response_model=ReplayResponse)
async def replay_llm_record(
    llm_id: str,
    mode: Literal["stored", "live"] = Query(default="stored"),
) -> ReplayResponse:
    record = await llm_record_store.get_record(llm_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LLM 记录不存在")

    if mode == "stored":
        return ReplayResponse(
            llm_id=llm_id,
            mode="stored",
            output=record.output,
            error=record.error,
        )

    body = dict(record.request_body)
    body["stream"] = False
    cfg = get_effective_config()
    start = time.perf_counter()

    if cfg.protocol == "anthropic":
        ant_body = proxy_routes._to_anthropic_request(body)
        url = proxy_routes._anthropic_upstream_url()
        headers = proxy_routes._anthropic_headers()
        response = await proxy_routes._anthropic_normal(url, headers, ant_body, cfg.timeout)
    else:
        url = proxy_routes._openai_upstream_url("/chat/completions")
        headers = proxy_routes._openai_headers()
        response = await proxy_routes._openai_normal(url, headers, body, cfg.timeout)

    output = extract_text_from_openai_response(response)
    latency_ms = int((time.perf_counter() - start) * 1000)
    logger.info(
        "LLM 重放完成: llm_id=%s mode=live latency=%dms output_len=%d",
        llm_id, latency_ms, len(output),
    )
    return ReplayResponse(
        llm_id=llm_id,
        mode="live",
        output=output,
        response=response,
    )
