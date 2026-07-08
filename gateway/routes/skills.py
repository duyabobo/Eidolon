import logging

from fastapi import APIRouter, HTTPException, Query, status

from models.skill import SkillListItem
from services import skill_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("", response_model=list[SkillListItem])
async def list_skills(
    user_id: str | None = Query(None, description="用户 ID，合并展示系统 Skill 与该用户的 Skill"),
) -> list[SkillListItem]:
    """Skill 列表：元数据来自 MongoDB（系统 + 用户）。"""
    return await skill_store.list_skills_for_user(user_id)


@router.get("/{name}/content")
async def get_skill_content(
    name: str,
    user_id: str | None = Query(None, description="用户 ID；不传则读取系统 Skill 正文"),
) -> dict:
    """读取 Skill 正文（SKILL.md），按需访问 NFS。"""
    try:
        raw = await skill_store.read_skill_content(name, user_id.strip() if user_id else None)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {"name": name, "user_id": user_id, "raw": raw}
