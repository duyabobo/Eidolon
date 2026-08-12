"""Session 只读查询：CM 架构下替代原 gateway-sse/services/mongo_client.py。

session 的创建 / 状态迁移 / 事件追加均由 gateway（API 服务）写入，
gateway-sse 不做任何写操作。
"""
import logging

from pi_shared.sqlite import loads

from cm_server.gateway_sse.models.session import SessionDocument
from cm_server.gateway_sse.services.db import get_db

logger = logging.getLogger(__name__)


async def get_session(session_id: str) -> SessionDocument | None:
    """
    只读查询：SSE 连接建立时校验 session 是否存在，并读取历史快照供断线重连回放。
    """
    row = await get_db().fetch_one(
        "SELECT id, status, events_snapshot FROM sessions WHERE id = ?", (session_id,)
    )
    if row is None:
        return None
    return SessionDocument(
        _id=row["id"],
        status=row["status"],
        events_snapshot=loads(row.get("events_snapshot"), []),
    )
