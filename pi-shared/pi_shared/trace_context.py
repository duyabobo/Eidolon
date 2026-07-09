import contextvars
import uuid

HEADER_TRACE_ID = "X-Trace-Id"
MISSING_TRACE_ID = "-"

_trace_id: contextvars.ContextVar[str] = contextvars.ContextVar("trace_id", default=MISSING_TRACE_ID)


def resolve_trace_id(incoming: str | None) -> str:
    if incoming and incoming.strip():
        return incoming.strip()
    return uuid.uuid4().hex


def set_trace_id(trace_id: str) -> contextvars.Token[str]:
    return _trace_id.set(trace_id)


def reset_trace_id(token: contextvars.Token[str]) -> None:
    _trace_id.reset(token)


def get_trace_id() -> str:
    return _trace_id.get()


def merge_trace_headers(headers: dict[str, str] | None = None) -> dict[str, str]:
    merged = dict(headers or {})
    trace_id = get_trace_id()
    if trace_id != MISSING_TRACE_ID:
        merged[HEADER_TRACE_ID] = trace_id
    return merged
