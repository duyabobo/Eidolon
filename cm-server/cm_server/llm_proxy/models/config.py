from typing import Literal

from pydantic import BaseModel, Field


class LlmConfig(BaseModel):
    base_url: str
    api_key: str
    model: str
    timeout: int = 120
    protocol: Literal["openai", "anthropic"] = "openai"


class LlmProfile(LlmConfig):
    id: str
    name: str = Field(..., min_length=1, max_length=64)


class LlmProfileCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    base_url: str
    api_key: str
    model: str
    timeout: int = 120
    protocol: Literal["openai", "anthropic"] = "openai"


class LlmProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    timeout: int | None = None
    protocol: Literal["openai", "anthropic"] | None = None


class LlmProfileListResponse(BaseModel):
    items: list[LlmProfile]
    active_id: str | None = None
    intent_id: str | None = None


class LlmIntentAssign(BaseModel):
    profile_id: str | None = None


class ServiceTestResult(BaseModel):
    ok: bool
    latency_ms: int = 0
    message: str = ""
