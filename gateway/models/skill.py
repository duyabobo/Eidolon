from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class SkillScope(str, Enum):
    SYSTEM = "system"
    USER = "user"


class SkillMeta(BaseModel):
    name: str
    description: str
    user_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    hidden: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SkillListItem(BaseModel):
    name: str
    description: str
    scope: SkillScope
    tags: list[str] = Field(default_factory=list)
    user_id: str | None = None


class SkillCreateRequest(BaseModel):
    description: str
    content: str
    tags: list[str] = Field(default_factory=list)
