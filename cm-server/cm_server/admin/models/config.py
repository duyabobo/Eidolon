from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from pi_shared import now_china

McpTransport = Literal["http", "stdio"]


class McpServerConfig(BaseModel):
    """MCP / 本机插件配置。http 用 url；stdio 用 command + args + cwd。"""

    url: str = ""
    description: str = ""
    enabled: bool = True
    api_key: str = ""
    transport: McpTransport = "http"
    command: str = ""
    args: list[str] = Field(default_factory=list)
    cwd: str = ""

    @model_validator(mode="after")
    def validate_launch(self) -> "McpServerConfig":
        if self.transport == "stdio":
            if not self.command.strip():
                raise ValueError("本机插件必须提供 command")
            return self
        if not self.url.strip():
            raise ValueError("远程 MCP 必须提供 url")
        return self


class McpConfig(BaseModel):
    servers: dict[str, McpServerConfig] = {}


class SkillMeta(BaseModel):
    """
    本地 SQLite 存储 Skill 元数据（列表/下拉用，不含正文）。
    user_id 为空表示系统 Skill；否则为用户私有 Skill。
    正文在 NFS：global/skills/{name}/ 或 users/{user_id}/skills/{name}/。

    mcp_tools：运行时白名单，精确到工具名，由 mcp-proxy 按此过滤可用 MCP 工具
      （见 pi-runtime/src/skill-mcp.ts、mcp-proxy/services/mcp_cache_manager.py）。
      Skill 只描述工具名，不记录工具来自哪个业务 MCP Server（Agent 侧看不到 Server 名，记了没用）。

    source：来源标记。空=对话创建/已归自己；github=从 GitHub 导入（可继续编辑，发布后清空）。
    """
    name: str
    description: str
    user_id: str | None = None
    tags: list[str] = []
    mcp_tools: list[str] = []
    hidden: bool = False
    source: str = ""
    created_at: datetime = None  # type: ignore[assignment]
    updated_at: datetime = None  # type: ignore[assignment]

    def model_post_init(self, __context: object) -> None:
        now = now_china()
        if self.created_at is None:
            self.created_at = now
        if self.updated_at is None:
            self.updated_at = now


class SkillCreateRequest(BaseModel):
    """创建/更新 Skill 时的请求体（含 content，用于写入文件系统）"""
    description: str
    content: str
    tags: list[str] = []
    hidden: bool = False
