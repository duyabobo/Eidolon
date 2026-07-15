from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field
from pi_shared import now_china


class SkillScope(str, Enum):
    SYSTEM = "system"
    USER = "user"


class SkillMeta(BaseModel):
    name: str
    description: str
    user_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    # mcp_servers 仅作展示/溯源用（这个 skill 的工具来自哪些 Server），不再参与运行时过滤
    mcp_servers: list[str] = Field(default_factory=list)
    # mcp_tools：运行时白名单，精确到工具名，由 mcp-proxy 按此过滤（见 pi-runtime/src/skill-mcp.ts）
    mcp_tools: list[str] = Field(default_factory=list)
    hidden: bool = False
    created_at: datetime = Field(default_factory=now_china)
    updated_at: datetime = Field(default_factory=now_china)


class SkillListItem(BaseModel):
    name: str
    description: str
    scope: SkillScope
    tags: list[str] = Field(default_factory=list)
    mcp_servers: list[str] = Field(default_factory=list)
    mcp_tools: list[str] = Field(default_factory=list)
    user_id: str | None = None


class SkillCreateRequest(BaseModel):
    description: str
    content: str
    tags: list[str] = Field(default_factory=list)
