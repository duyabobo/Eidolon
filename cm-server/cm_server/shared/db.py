"""合并后唯一的本地 SQLite 连接。

合并前 gateway/gateway-sse/admin/llm-proxy/mcp-proxy 各自持有一个 `Database` 实例，
但都指向同一个文件、执行同一份 `pi_shared.sqlite.SCHEMA_SQL`——这在多进程部署下是
必要的（每个进程要能独立连接），合并成单进程后就是纯粹的重复连接，改为一份。

各服务子包下的 `services/db.py` 保留原文件名与 `get_db()`/`connect()`/`disconnect()`
签名，只是把实现转发到这里，这样服务内部原有的 `from services.db import get_db`
只需要改前缀成 `from cm_server.<pkg>.services.db import get_db`，不需要再改调用方式。
"""
import logging

from pi_shared.sqlite import SCHEMA_SQL, Database

from cm_server.config import settings

logger = logging.getLogger(__name__)

_db = Database(settings.sqlite_path)


def get_db() -> Database:
    return _db


async def connect() -> None:
    await _db.connect(schema_sql=SCHEMA_SQL)
    logger.info("SQLite 连接成功: %s", settings.sqlite_path)


async def disconnect() -> None:
    await _db.disconnect()
