from datetime import datetime
from pydantic import BaseModel, model_validator
from pi_shared import now_china


class McpServerConfig(BaseModel):
    """
    MCP Server 配置。

    只允许 HTTP/SSE 远程类型（url 字段）。
    stdio 本地进程类型（command + args）被明确禁止：本地进程在 pi-runtime 容器内以 root 运行，
    可访问 Docker 内网（MongoDB/Redis 等），是不可接受的攻击面。
    """
    url: str
    description: str = ""
    enabled: bool = True
    api_key: str = ""

    @model_validator(mode="before")
    @classmethod
    def reject_command_based(cls, values: dict) -> dict:
        if values.get("command"):
            raise ValueError(
                "不允许配置 command 类型的 MCP Server（会在容器内启动本地进程）。"
                "请改用 url 类型（HTTP/SSE 远程 MCP Server）。"
            )
        if not values.get("url"):
            raise ValueError("MCP Server 必须提供 url 字段（HTTP/SSE 远程端点）。")
        return values


class McpConfig(BaseModel):
    servers: dict[str, McpServerConfig] = {}


class SkillMeta(BaseModel):
    """
    MongoDB 存储 Skill 元数据（列表/下拉用，不含正文）。
    user_id 为空表示系统 Skill；否则为用户私有 Skill。
    正文在 NFS：global/skills/{name}/ 或 users/{user_id}/skills/{name}/。

    mcp_tools：运行时白名单，精确到工具名，由 mcp-proxy 按此过滤可用 MCP 工具
      （见 pi-runtime/src/skill-mcp.ts、mcp-proxy/services/mcp_cache_manager.py）。
      Skill 只描述工具名，不记录工具来自哪个业务 MCP Server（Agent 侧看不到 Server 名，记了没用）。
    """
    name: str
    description: str
    user_id: str | None = None
    tags: list[str] = []
    mcp_tools: list[str] = []
    hidden: bool = False
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
    content: str                  # 完整 SKILL.md 正文（frontmatter 由 admin 自动生成）
    tags: list[str] = []
    hidden: bool = False
