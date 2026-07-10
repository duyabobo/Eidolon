from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field
from pi_shared import now_china


class SkillDraft(BaseModel):
    name: str
    description: str
    content: str
    tags: list[str] = Field(default_factory=list)
    mcp_servers: list[str] = Field(default_factory=list)
    mcp_tools_reference: str = ""


class SkillCreatorMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime = Field(default_factory=now_china)


class SkillCreatorSession(BaseModel):
    id: str
    user_id: str | None = None
    messages: list[SkillCreatorMessage] = Field(default_factory=list)
    draft: SkillDraft | None = None
    # 发布状态：False 表示草稿进行中，True 表示已发布为 Skill
    published: bool = False
    # 发布后记录对应的 Skill 名称，用于"编辑已保存 Skill"时精确查找会话
    skill_name: str | None = None
    created_at: datetime = Field(default_factory=now_china)
    updated_at: datetime = Field(default_factory=now_china)


class CreateSessionResponse(BaseModel):
    session_id: str
    message: SkillCreatorMessage


class SendMessageRequest(BaseModel):
    content: str


class SendMessageResponse(BaseModel):
    message: SkillCreatorMessage
    draft: SkillDraft | None = None


class PublishSkillRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    content: str | None = None
    tags: list[str] | None = None
    hidden: bool = False
