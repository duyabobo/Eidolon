"""LLM 调用记录：CM 架构下替代原 Mongo `llm_calls` 集合（Mongo → SQLite）。"""
import logging
import uuid
from typing import Any

from pi_shared import format_iso, now_china
from pi_shared.sqlite import dumps, loads

from cm_server.llm_proxy.models.config import LlmConfig
from cm_server.llm_proxy.models.llm_record import LlmCallRecord, LlmCallRecordSummary
from cm_server.llm_proxy.services.db import get_db

logger = logging.getLogger(__name__)


def new_llm_id() -> str:
    return str(uuid.uuid4())


def _to_record(row: dict) -> LlmCallRecord:
    return LlmCallRecord(
        llm_id=row["llm_id"],
        session_id=row.get("session_id"),
        question_id=row.get("question_id"),
        messages=loads(row.get("messages"), []),
        output=row.get("output"),
        stream=bool(row.get("stream", 0)),
        status=row["status"],
        error=row.get("error"),
        model=row["model"],
        protocol=row["protocol"],
        base_url=row["base_url"],
        request_body=loads(row.get("request_body"), {}),
        created_at=row["created_at"],
        completed_at=row.get("completed_at"),
        latency_ms=row.get("latency_ms"),
    )


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
    created_at = now_china()
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
        created_at=created_at,
    )
    await get_db().execute(
        """
        INSERT INTO llm_calls
            (llm_id, session_id, question_id, messages, stream, status, model, protocol, base_url, request_body, created_at)
        VALUES
            (:llm_id, :session_id, :question_id, :messages, :stream, :status, :model, :protocol, :base_url, :request_body, :created_at)
        """,
        {
            "llm_id": llm_id,
            "session_id": session_id,
            "question_id": question_id,
            "messages": dumps(messages),
            "stream": int(stream),
            "status": "in_progress",
            "model": cfg.model,
            "protocol": cfg.protocol,
            "base_url": cfg.base_url,
            "request_body": dumps(request_body),
            "created_at": format_iso(created_at),
        },
    )
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
    await get_db().execute(
        """
        UPDATE llm_calls
        SET output = :output, status = :status, latency_ms = :latency_ms, completed_at = :completed_at
        WHERE llm_id = :llm_id
        """,
        {
            "output": output,
            "status": status,
            "latency_ms": latency_ms,
            "completed_at": format_iso(now_china()),
            "llm_id": llm_id,
        },
    )
    if error is not None:
        await get_db().execute("UPDATE llm_calls SET error = ? WHERE llm_id = ?", (error, llm_id))
    logger.info(
        "LLM 记录已完成: llm_id=%s status=%s latency=%dms output_len=%d",
        llm_id, status, latency_ms, len(output),
    )


async def get_record(llm_id: str) -> LlmCallRecord | None:
    row = await get_db().fetch_one("SELECT * FROM llm_calls WHERE llm_id = ?", (llm_id,))
    return _to_record(row) if row else None


async def list_records(
    *,
    session_id: str | None = None,
    question_id: str | None = None,
    limit: int = 50,
) -> list[LlmCallRecordSummary]:
    clauses: list[str] = []
    params: dict[str, Any] = {"limit": limit}
    if session_id:
        clauses.append("session_id = :session_id")
        params["session_id"] = session_id
    if question_id:
        clauses.append("question_id = :question_id")
        params["question_id"] = question_id
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    rows = await get_db().fetch_all(
        f"""
        SELECT llm_id, session_id, question_id, stream, status, model, created_at, completed_at, latency_ms
        FROM llm_calls {where} ORDER BY created_at DESC LIMIT :limit
        """,
        params,
    )
    return [
        LlmCallRecordSummary(
            llm_id=row["llm_id"],
            session_id=row.get("session_id"),
            question_id=row.get("question_id"),
            stream=bool(row.get("stream", 0)),
            status=row["status"],
            model=row["model"],
            created_at=row["created_at"],
            completed_at=row.get("completed_at"),
            latency_ms=row.get("latency_ms"),
        )
        for row in rows
    ]
