import logging

from fastapi import APIRouter, HTTPException, Query, status

from cm_server.gateway.models.skill import SkillListItem
from cm_server.gateway.services import skill_store
from cm_server.shared.machine_uid import current_user_id, owner_id_for_scope

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("", response_model=list[SkillListItem])
async def list_skills() -> list[SkillListItem]:
    """Skill 列表：系统 + 本机。"""
    return await skill_store.list_skills_for_user(await current_user_id())


@router.get("/{name}/content")
async def get_skill_content(
    name: str,
    scope: str | None = Query(None, description="user 读本机 Skill，否则读系统 Skill"),
) -> dict:
    """读取 Skill 正文（SKILL.md）。"""
    owner_id = await owner_id_for_scope(scope)
    try:
        raw = await skill_store.read_skill_content(name, owner_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {"name": name, "scope": "user" if owner_id else "system", "raw": raw}
