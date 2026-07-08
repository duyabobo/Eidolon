import logging

from fastapi import APIRouter, HTTPException, status

from models.config import SkillCreateRequest, SkillMeta
from models.skill_creator import (
    CreateSessionResponse,
    PublishSkillRequest,
    SendMessageRequest,
    SendMessageResponse,
    SkillCreatorSession,
)
from services import skill_creator_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config/skills/creator", tags=["skill-creator"])


@router.post("/sessions", response_model=CreateSessionResponse)
async def create_session() -> CreateSessionResponse:
    """创建 skill-creator 对话会话并返回首条助手消息。"""
    try:
        return await skill_creator_service.start_session()
    except RuntimeError as exc:
        logger.exception("创建 skill-creator 会话失败")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/sessions/{session_id}", response_model=SkillCreatorSession)
async def get_session(session_id: str) -> SkillCreatorSession:
    session = await skill_creator_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    return session


@router.post("/sessions/{session_id}/messages", response_model=SendMessageResponse)
async def send_message(session_id: str, body: SendMessageRequest) -> SendMessageResponse:
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="消息不能为空")
    try:
        return await skill_creator_service.send_user_message(session_id, content)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.exception("skill-creator 对话失败 session=%s", session_id)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/publish", response_model=SkillMeta)
async def publish_skill(session_id: str, body: PublishSkillRequest) -> SkillMeta:
    """将对话草稿（或用户覆盖字段）发布为 global skill。"""
    try:
        return await skill_creator_service.publish_session(session_id, body)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
