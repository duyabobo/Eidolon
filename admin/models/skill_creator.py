from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


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
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SkillCreatorSession(BaseModel):
    id: str
    user_id: str | None = None
    messages: list[SkillCreatorMessage] = Field(default_factory=list)
    draft: SkillDraft | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


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
