"""合并后共用同一个 SQLite 连接，见 cm_server.shared.db；此处仅按原路径转发。"""
from cm_server.shared.db import connect, disconnect, get_db

__all__ = ["connect", "disconnect", "get_db"]
