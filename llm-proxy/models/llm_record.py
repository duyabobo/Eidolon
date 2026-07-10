from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field
from pi_shared import now_china


class LlmCallRecord(BaseModel):
    llm_id: str
    session_id: str | None = None
    question_id: str | None = None
    messages: list[dict[str, Any]]
    output: str | None = None
    stream: bool = False
    status: Literal["in_progress", "completed", "error"] = "in_progress"
    error: str | None = None
    model: str
    protocol: str
    base_url: str
    request_body: dict[str, Any]
    created_at: datetime = Field(default_factory=now_china)
    completed_at: datetime | None = None
    latency_ms: int | None = None


class LlmCallRecordSummary(BaseModel):
    llm_id: str
    session_id: str | None = None
    question_id: str | None = None
    stream: bool
    status: str
    model: str
    created_at: datetime
    completed_at: datetime | None = None
    latency_ms: int | None = None


class ReplayResponse(BaseModel):
    llm_id: str
    mode: Literal["stored", "live"]
    output: str | None = None
    response: dict[str, Any] | None = None
    error: str | None = None
