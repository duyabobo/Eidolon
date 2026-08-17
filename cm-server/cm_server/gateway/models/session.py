from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field
from pi_shared import now_china


class SessionStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    # 沙盒因闲置超时被回收，session 仍可重启（区别于用户主动关闭的 COMPLETED）
    IDLE = "IDLE"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class SessionDocument(BaseModel):
    """本地 SQLite sessions 表对应的 session 完整记录"""

    id: str = Field(alias="_id")
    user_id: str
    conversation_id: str | None = None
    status: SessionStatus = SessionStatus.PENDING
    request: str
    skill_ids: list[str] = Field(default_factory=list)
    events_snapshot: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=now_china)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None

    class Config:
        populate_by_name = True


class CreateSessionRequest(BaseModel):
    request: str
    turn_id: str           # 第一个轮次 ID，由前端生成（UUID），用于 SSE stream key
    skill_ids: list[str] = []
    # True：只建 SQLite 记录，不投递执行（用于先上传附件再发首条消息）
    defer_start: bool = False


class SendMessageRequest(BaseModel):
    """向已有 session 发送新消息（新轮次）"""
    # 用户可见原文，写入 SQLite events_snapshot
    request: str
    turn_id: str           # 本轮次 ID，由前端生成，用于 SSE stream key
    skill_ids: list[str] = []
    # 发给 pi 的完整 prompt（可含附件元数据）；缺省则与 request 相同
    agent_request: str | None = None


class SendMessageResponse(BaseModel):
    turn_id: str
    session_id: str


class CreateSessionResponse(BaseModel):
    session_id: str
    status: SessionStatus
    deferred: bool = False


class SessionSummary(BaseModel):
    """用于历史列表的轻量摘要（一个 session = 一个 chat 窗口）"""
    session_id: str
    status: SessionStatus
    request: str
    created_at: datetime
    completed_at: datetime | None = None


class ConversationSummary(BaseModel):
    """对话维度聚合摘要，供侧边栏历史列表展示（一条对话一个条目）"""
    conversation_id: str
    first_request: str
    last_status: SessionStatus
    last_created_at: datetime
    session_count: int


class ConversationSession(BaseModel):
    """对话内单个 session 的消息视图（含 events_snapshot，供前端重建消息列表）"""
    session_id: str
    status: SessionStatus
    request: str
    events_snapshot: list[dict[str, Any]] = Field(default_factory=list)
