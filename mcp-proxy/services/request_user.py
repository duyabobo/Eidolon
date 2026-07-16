"""
当前入站请求的用户身份（来自可信的 X-User-Id）。

由 routes 在处理请求时写入 ContextVar，mcp_connection 的 httpx hook
在发往下游 MCP 时按请求注入同名 header，从而在系统级共享连接下仍不串用户。
无 user 时不带头（兼容探测 / 预热）。
"""
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Iterator

_REQUEST_USER_ID: ContextVar[str | None] = ContextVar("mcp_proxy_request_user_id", default=None)

X_USER_ID_HEADER = "X-User-Id"


def get_request_user_id() -> str | None:
    return _REQUEST_USER_ID.get()


def set_request_user_id(user_id: str | None) -> Token:
    normalized = user_id.strip() if user_id and user_id.strip() else None
    return _REQUEST_USER_ID.set(normalized)


def reset_request_user_id(token: Token) -> None:
    _REQUEST_USER_ID.reset(token)


@contextmanager
def request_user_context(user_id: str | None) -> Iterator[None]:
    token = set_request_user_id(user_id)
    try:
        yield
    finally:
        reset_request_user_id(token)
