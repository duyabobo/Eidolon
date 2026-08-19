import logging
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class McpScope(str, Enum):
    SYSTEM = "system"
    USER = "user"


class McpServerItem(BaseModel):
    name: str
    url: str = ""
    description: str = ""
    enabled: bool = True
    has_api_key: bool = False
    scope: McpScope
    user_id: str | None = None
    transport: str = "http"
    command: str = ""
    args: list[str] = Field(default_factory=list)
    cwd: str = ""


class McpServerCreateRequest(BaseModel):
    url: str = ""
    description: str = ""
    enabled: bool = True
    api_key: str = ""
    transport: str = "http"
    command: str = ""
    args: list[str] = Field(default_factory=list)
    cwd: str = ""


class McpServerStatusItem(BaseModel):
    name: str
    scope: str
    url: str
    enabled: bool = True
    available: bool
    tool_count: int
    tools: list[str] = Field(default_factory=list)
    error: str = ""
    latency_ms: int = 0
    skipped: bool = False


class McpServerStatusResponse(BaseModel):
    servers: list[McpServerStatusItem]
