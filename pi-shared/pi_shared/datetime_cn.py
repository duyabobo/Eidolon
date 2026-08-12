"""统一东八区时间：业务读写均以 Asia/Shanghai 墙钟为准。"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

CHINA_TZ = ZoneInfo("Asia/Shanghai")
CHINA_UTC_OFFSET = "+08:00"


def now() -> datetime:
    """当前东八区墙钟时间（naive，写入本地 SQLite / 模型字段）。"""
    return datetime.now(CHINA_TZ).replace(tzinfo=None)


def now_aware() -> datetime:
    """当前东八区时间（带 tzinfo）。"""
    return datetime.now(CHINA_TZ)


def now_ms() -> int:
    """当前东八区对应的 Unix 毫秒时间戳。"""
    return int(datetime.now(CHINA_TZ).timestamp() * 1000)


def to_china(dt: datetime) -> datetime:
    """转为东八区墙钟 naive。aware 先换算；naive 视为已是东八区。"""
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(CHINA_TZ).replace(tzinfo=None)


def format_iso(dt: datetime) -> str:
    """API 输出：东八区 ISO，固定带 +08:00。"""
    china = to_china(dt).replace(tzinfo=CHINA_TZ)
    return china.isoformat()


def install_json_encoders() -> None:
    """让 FastAPI / pydantic jsonable_encoder 将 datetime 序列化为东八区。"""
    from fastapi.encoders import ENCODERS_BY_TYPE

    ENCODERS_BY_TYPE[datetime] = format_iso
