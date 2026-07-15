import logging

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status

from models.config import SkillMeta
from models.skill_creator import (
    PublishSkillRequest,
    SendMessageRequest,
    SendMessageResponse,
    SkillCreatorSession,
    SkillCreatorUploadResponse,
)
from services import skill_creator_service
from services.skills_fs import save_skill_creator_upload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config/skills/creator", tags=["skill-creator"])


@router.post("/sessions", response_model=SkillCreatorSession)
async def create_session(
    user_id: str | None = Query(None, description="用户 ID；不传则创建系统 Skill"),
    force_new: bool = Query(False, description="强制新建会话（「新建对话」按钮使用）"),
    skill_name: str | None = Query(None, description="编辑已保存的 Skill 时传入，精确加载对应会话"),
) -> SkillCreatorSession:
    """获取或新建 skill-creator 会话。

    优先级：
    - skill_name 指定：加载该 Skill 的会话（编辑模式）
    - force_new=true：强制新建
    - 默认：复用未发布草稿，无则新建
    """
    uid = user_id.strip() if user_id else None
    sn = skill_name.strip() if skill_name else None
    return await skill_creator_service.start_session(uid, force_new=force_new, skill_name=sn)


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


@router.post("/sessions/{session_id}/reset", response_model=SkillCreatorSession)
async def reset_session(session_id: str) -> SkillCreatorSession:
    """清空未发布会话的历史消息和草稿，重置为初始状态。"""
    try:
        return await skill_creator_service.reset_session(session_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/publish", response_model=SkillMeta)
async def publish_skill(session_id: str, body: PublishSkillRequest) -> SkillMeta:
    """发布 Skill：MongoDB 元数据 + NFS 正文同步写入。"""
    try:
        return await skill_creator_service.publish_session(session_id, body)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/sessions/{session_id}/files",
    response_model=SkillCreatorUploadResponse,
    summary="Skill Creator 会话附件上传（写入 skill 目录 uploads/）",
)
async def upload_session_file(
    session_id: str,
    file: UploadFile = File(...),
) -> SkillCreatorUploadResponse:
    """将文件存到对应 skill 目录；尚无名称时暂存 _creator/{session_id}/uploads/。"""
    session = await skill_creator_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")

    data = await file.read()
    filename = file.filename or "upload.bin"
    draft_name = session.draft.name if session.draft else None
    try:
        result = save_skill_creator_upload(
            user_id=session.user_id,
            session_id=session.id,
            skill_name=session.skill_name,
            draft_name=draft_name,
            filename=filename,
            data=data,
        )
        return SkillCreatorUploadResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
