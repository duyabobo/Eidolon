from fastapi import APIRouter, HTTPException, status

from cm_server.llm_proxy.models.config import (
    LlmConfig,
    LlmProfile,
    LlmProfileCreate,
    LlmProfileListResponse,
    LlmProfileUpdate,
    ServiceTestResult,
)
from cm_server.llm_proxy.services import llm_profile_store
from cm_server.llm_proxy.services.llm_config_store import activate_profile, get_effective_config
from cm_server.llm_proxy.services.llm_probe import probe_llm_profile

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/llm", response_model=LlmConfig)
async def get_llm_config() -> LlmConfig:
    return get_effective_config()


@router.get("/llm/profiles", response_model=LlmProfileListResponse)
async def list_llm_profiles() -> LlmProfileListResponse:
    items, active_id = await llm_profile_store.list_llm_profiles()
    return LlmProfileListResponse(items=items, active_id=active_id)


@router.post("/llm/profiles", response_model=LlmProfile, status_code=status.HTTP_201_CREATED)
async def create_llm_profile(body: LlmProfileCreate) -> LlmProfile:
    profile = await llm_profile_store.create_llm_profile(body)
    items, active_id = await llm_profile_store.list_llm_profiles()
    if not active_id:
        await activate_profile(profile.id)
    return profile


@router.put("/llm/profiles/{profile_id}", response_model=LlmProfile)
async def update_llm_profile(profile_id: str, body: LlmProfileUpdate) -> LlmProfile:
    updated = await llm_profile_store.update_llm_profile(profile_id, body)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LLM 配置不存在")
    _, active_id = await llm_profile_store.list_llm_profiles()
    if active_id == profile_id:
        await activate_profile(profile_id)
    return updated


@router.delete("/llm/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_llm_profile(profile_id: str) -> None:
    items, active_id = await llm_profile_store.list_llm_profiles()
    if len(items) <= 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="至少保留一个聊天大模型配置")
    if not await llm_profile_store.delete_llm_profile(profile_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LLM 配置不存在")
    if active_id == profile_id:
        remaining = [p for p in items if p.id != profile_id]
        if remaining:
            await activate_profile(remaining[0].id)


@router.put("/llm/profiles/{profile_id}/activate", response_model=LlmConfig)
async def activate_llm_profile(profile_id: str) -> LlmConfig:
    try:
        return await activate_profile(profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/llm/profiles/{profile_id}/test", response_model=ServiceTestResult)
async def test_llm_profile(profile_id: str) -> ServiceTestResult:
    profile = await llm_profile_store.get_llm_profile(profile_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LLM 配置不存在")
    return await probe_llm_profile(profile)
