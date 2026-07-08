from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SkillDraft(BaseModel):
    name: str
    description: str
    content: str
    tags: list[str] = Field(default_factory=list)


class SkillCreatorMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SkillCreatorSession(BaseModel):
    id: str
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
