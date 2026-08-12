"""
当前入站请求的用户身份（来自可信的 X-User-Id）。

由 routes 在处理请求时写入 ContextVar，mcp_connection 的 httpx hook
在发往下游 MCP 时按请求注入同名 header，从而在系统级共享连接下仍不串用户。
无 user 时不带头（兼容探测 / 预热）。

SSE 特例：MCP SDK 的 post_writer 跑在独立 anyio task，创建时拷贝的 ContextVar
看不到后续请求里的 user。因此每个下游连接另有 OutboundUserIdSlot，由 call_tool
在发请求前写入，hook 优先读槽位。
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


class OutboundUserIdSlot:
    """跨 SSE post_writer task 传递当前 tools/call 的用户身份（可变槽位，非 ContextVar）。"""

    __slots__ = ("_user_id",)

    def __init__(self) -> None:
        self._user_id: str | None = None

    def set(self, user_id: str | None) -> None:
        self._user_id = user_id.strip() if user_id and user_id.strip() else None

    def clear(self) -> None:
        self._user_id = None

    def get(self) -> str | None:
        return self._user_id
