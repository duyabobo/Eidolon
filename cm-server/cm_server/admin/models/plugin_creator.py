from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field
from pi_shared import now_china


class PluginDraft(BaseModel):
    name: str
    description: str
    server_py: str


class PluginCreatorMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime = Field(default_factory=now_china)


class PluginCreatorSession(BaseModel):
    id: str
    user_id: str | None = None
    messages: list[PluginCreatorMessage] = Field(default_factory=list)
    draft: PluginDraft | None = None
    published: bool = False
    plugin_name: str | None = None
    created_at: datetime = Field(default_factory=now_china)
    updated_at: datetime = Field(default_factory=now_china)


class PluginSendMessageRequest(BaseModel):
    content: str


class PluginSendMessageResponse(BaseModel):
    message: PluginCreatorMessage
    draft: PluginDraft | None = None


class PublishPluginRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    server_py: str | None = None
