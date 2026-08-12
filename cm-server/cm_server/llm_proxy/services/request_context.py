from dataclasses import dataclass

from fastapi import Request

HEADER_SESSION_ID = "x-session-id"
HEADER_QUESTION_ID = "x-question-id"


@dataclass(frozen=True)
class LlmRequestContext:
    session_id: str | None
    question_id: str | None


def extract_request_context(request: Request) -> LlmRequestContext:
    return LlmRequestContext(
        session_id=request.headers.get(HEADER_SESSION_ID),
        question_id=request.headers.get(HEADER_QUESTION_ID),
    )
