import logging
import time

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from pi_shared.trace_context import (
    HEADER_TRACE_ID,
    reset_trace_id,
    resolve_trace_id,
    set_trace_id,
)

_MAX_BODY_CHARS = 2000
_SKIP_PATHS = {"/health"}
# 高频只读列表：不打 access（否则停留在工具/经验页时日志会被刷屏）
_SKIP_GET_PATHS = frozenset({"/mcp", "/skills"})
# GET 成功时不落 resp 正文（列表/静态读接口体积大且无排障价值）
_SKIP_RESP_BODY_GET_PREFIXES = ("/mcp", "/skills", "/config/", "/sessions")

logger = logging.getLogger("access")


def _truncate(text: str) -> str:
    if len(text) <= _MAX_BODY_CHARS:
        return text
    return f"{text[:_MAX_BODY_CHARS]}...[+{len(text) - _MAX_BODY_CHARS} chars]"


async def _read_and_replay_body(receive: Receive) -> tuple[bytes, Receive]:
    """读取完整请求体，并返回可重放的 receive，避免 app 层读取时 body 已被消费。"""
    chunks: list[bytes] = []
    more_body = True
    while more_body:
        message = await receive()
        if message["type"] != "http.request":
            break
        chunks.append(message.get("body", b""))
        more_body = message.get("more_body", False)

    body = b"".join(chunks)
    replayed = False

    async def replay_receive() -> Message:
        nonlocal replayed
        if not replayed:
            replayed = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()

    return body, replay_receive


def _emit_log(
    trace_id: str,
    method: str,
    path: str,
    req_body: str,
    resp_chunks: list[bytes] | None,
    status_code: int,
    start: float,
) -> None:
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    skip_resp = (
        method == "GET"
        and status_code < 400
        and any(path == p or path.startswith(p) for p in _SKIP_RESP_BODY_GET_PREFIXES)
    )
    if resp_chunks is None:
        resp_body = "[stream]"
    elif skip_resp:
        resp_body = f"[omitted {sum(len(c) for c in resp_chunks)}b]"
    else:
        resp_body = _truncate(
            b"".join(resp_chunks).decode("utf-8", errors="replace")
        )
    logger.info(
        "traceId=%s method=%s path=%s status=%d timecost=%dms req=%s resp=%s",
        trace_id, method, path, status_code, elapsed_ms, req_body, resp_body,
    )


class AccessLogMiddleware:
    """纯 ASGI 访问日志中间件，记录 method/path/req/resp/status/timecost。

    对 SSE 等流式响应不缓冲 body，仅记录 [stream] 占位，
    避免干扰 EventSourceResponse 的正常推送。
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method: str = scope.get("method", "")
        path: str = scope.get("path", "")

        if path in _SKIP_PATHS or (method == "GET" and path in _SKIP_GET_PATHS):
            await self.app(scope, receive, send)
            return

        incoming_headers = Headers(scope=scope)
        trace_id = resolve_trace_id(incoming_headers.get(HEADER_TRACE_ID))
        token = set_trace_id(trace_id)

        body_bytes, receive = await _read_and_replay_body(receive)
        req_body = _truncate(body_bytes.decode("utf-8", errors="replace"))
        start = time.perf_counter()

        status_code = 500
        is_stream = False
        resp_chunks: list[bytes] = []

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code, is_stream
            if message["type"] == "http.response.start":
                status_code = message["status"]
                headers = Headers(raw=message.get("headers", []))
                is_stream = "text/event-stream" in headers.get("content-type", "")
                raw_headers = list(message.get("headers", []))
                raw_headers.append((HEADER_TRACE_ID.lower().encode(), trace_id.encode()))
                message = {**message, "headers": raw_headers}
            elif message["type"] == "http.response.body" and not is_stream:
                chunk = message.get("body", b"")
                if chunk:
                    resp_chunks.append(chunk)
                if not message.get("more_body", False):
                    _emit_log(trace_id, method, path, req_body, resp_chunks, status_code, start)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
            if is_stream:
                _emit_log(trace_id, method, path, req_body, None, status_code, start)
        finally:
            reset_trace_id(token)
