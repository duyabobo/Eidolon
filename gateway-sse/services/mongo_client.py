import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from config import settings
from models.session import SessionDocument

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None


def get_db() -> AsyncIOMotorDatabase:
    if _client is None:
        raise RuntimeError("MongoDB 客户端未初始化，请先调用 connect()")
    return _client[settings.mongo_db]


async def connect() -> None:
    global _client
    _client = AsyncIOMotorClient(settings.mongo_uri)
    logger.info("MongoDB 连接成功: %s / %s", settings.mongo_uri, settings.mongo_db)


async def disconnect() -> None:
    global _client
    if _client:
        _client.close()
        _client = None
        logger.info("MongoDB 连接已关闭")


async def get_session(session_id: str) -> SessionDocument | None:
    """
    只读查询：SSE 连接建立时校验 session 是否存在，并读取历史快照供断线重连回放。

    session 的创建 / 状态迁移 / 事件追加均由 gateway（API 服务）写入，
    gateway-sse 不做任何写操作。
    """
    db = get_db()
    raw = await db.sessions.find_one({"_id": session_id})
    if raw is None:
        return None
    return SessionDocument(**raw)
