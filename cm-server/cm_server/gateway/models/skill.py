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
    # mcp_tools：运行时白名单，精确到工具名，由 mcp-proxy 按此过滤（见 pi-runtime/src/skill-mcp.ts）
    # 不记录 Server 名：pi 运行时看不到 Server 名，Skill 只需描述用到的工具
    mcp_tools: list[str] = Field(default_factory=list)
    hidden: bool = False
    # 空=对话创建/已归自己；github=GitHub 导入（可编辑，发布后清空）
    source: str = ""
    created_at: datetime = Field(default_factory=now_china)
    updated_at: datetime = Field(default_factory=now_china)


class SkillListItem(BaseModel):
    name: str
    description: str
    scope: SkillScope
    tags: list[str] = Field(default_factory=list)
    mcp_tools: list[str] = Field(default_factory=list)
    user_id: str | None = None
    source: str = ""


class SkillCreateRequest(BaseModel):
    description: str
    content: str
    tags: list[str] = Field(default_factory=list)
