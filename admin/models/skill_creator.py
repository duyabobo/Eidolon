from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field
from pi_shared import now_china


class SkillDraft(BaseModel):
    name: str
    description: str
    content: str
    tags: list[str] = Field(default_factory=list)
    # mcp_tools：运行时白名单，精确到工具名（如 wiki_combined_search），由平台按此过滤 MCP 工具
    # Skill 只需描述用到的工具名，不描述工具来自哪个业务 MCP Server（Agent 侧根本看不到 Server 名）
    mcp_tools: list[str] = Field(default_factory=list)
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


class SkillCreatorUploadResponse(BaseModel):
    """Skill Creator 会话附件上传结果（仅存储，不做后续融合处理）。"""

    filename: str
    relative_path: str = Field(description="相对 skill 目录的路径，如 uploads/doc.pdf")
    stored_path: str = Field(description="落盘绝对路径")
    skill_dir: str = Field(description="目标 skill 目录名（含 _creator/{session_id} 暂存）")
    size: int
