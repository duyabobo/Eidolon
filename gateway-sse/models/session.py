from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class SessionStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    # 沙盒因闲置超时被回收，session 仍可重启（区别于用户主动关闭的 COMPLETED）
    IDLE = "IDLE"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class SessionDocument(BaseModel):
    """
    MongoDB session 文档在 SSE 侧的只读投影。

    gateway-sse 只负责连接建立时的存在性校验与历史快照回放，不做任何写操作，
    因此仅声明这两个用途所需的字段（其余字段由 gateway 的写模型定义与维护）。
    """

    id: str = Field(alias="_id")
    status: SessionStatus = SessionStatus.PENDING
    events_snapshot: list[dict[str, Any]] = Field(default_factory=list)

    class Config:
        populate_by_name = True
