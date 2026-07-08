import logging

from fastapi import APIRouter, HTTPException, status

from models.config import SkillMeta
from services import mongo_client
from services.skills_fs import delete_skill_files, read_skill_content

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config/skills", tags=["skills"])


@router.get("", response_model=list[SkillMeta])
async def list_skills() -> list[SkillMeta]:
    """列出所有 global skill 元数据（不含正文，供前端下拉展示）"""
    return await mongo_client.list_skill_metas()


@router.get("/{name}/content")
async def get_skill_content(name: str) -> dict:
    """读取系统 skill 的 SKILL.md 原始内容（从 NFS 读取）"""
    content = read_skill_content(name)
    if content is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"skill '{name}' 文件不存在")
    return {"name": name, "raw": content}


@router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill(name: str) -> None:
    """删除系统 skill（MongoDB 元数据 + NFS 文件）"""
    fs_deleted = delete_skill_files(name)
    db_deleted = await mongo_client.delete_skill_meta(name)
    if not fs_deleted and not db_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"skill '{name}' 不存在")
