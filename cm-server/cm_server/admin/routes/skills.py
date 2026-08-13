import logging
import mimetypes

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

from cm_server.admin.models.config import SkillMeta
from cm_server.admin.services import skill_meta_store
from cm_server.admin.services.skill_github_import import import_skill_from_github
from cm_server.admin.services.skills_fs import (
    delete_skill_files,
    delete_user_skill_files,
    list_skill_tree,
    open_skill_file,
    read_skill_content,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config/skills", tags=["skills"])

_TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024


class GithubSkillImportRequest(BaseModel):
    github_url: str = Field(..., min_length=1, max_length=1024)
    user_id: str = Field(..., min_length=1, max_length=128)
    ref: str | None = Field(default=None, max_length=256)
    subdir: str | None = Field(default=None, max_length=512)
    overwrite: bool = False


@router.get("", response_model=list[SkillMeta])
async def list_skills() -> list[SkillMeta]:
    """列出所有 global skill 元数据（不含正文，供前端下拉展示）"""
    return await skill_meta_store.list_skill_metas()


@router.post("/import-from-github")
async def api_import_skill_from_github(body: GithubSkillImportRequest) -> dict:
    """从 GitHub 导入完整 Skill 目录（SKILL.md + scripts/references/assets 等）。"""
    return await import_skill_from_github(
        user_id=body.user_id,
        github_url=body.github_url,
        ref=body.ref,
        subdir=body.subdir,
        overwrite=body.overwrite,
    )


@router.get("/{name}/tree")
async def api_skill_tree(
    name: str,
    user_id: str | None = Query(None, description="用户 ID；不传则读系统 Skill"),
) -> dict:
    """列出 Skill 文件夹树。"""
    uid = user_id.strip() if user_id else None
    tree = list_skill_tree(name, uid)
    if tree is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"skill '{name}' 不存在")
    return tree


@router.get("/{name}/files")
async def api_skill_file(
    name: str,
    path: str = Query(..., description="相对 skill 根目录的文件路径"),
    user_id: str | None = Query(None, description="用户 ID；不传则读系统 Skill"),
    disposition: str = Query(default="inline", description="inline|attachment"),
    as_text: bool = Query(default=False, description="强制按文本返回（预览用）"),
):
    """读取 Skill 目录内单个文件（预览/下载）。"""
    uid = user_id.strip() if user_id else None
    opened = open_skill_file(name, path, uid)
    if opened is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    abs_path, filename = opened
    disp = (disposition or "inline").strip().lower()
    if disp not in {"inline", "attachment"}:
        disp = "inline"

    if as_text:
        if abs_path.stat().st_size > _TEXT_PREVIEW_MAX_BYTES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件过大，无法文本预览")
        text = abs_path.read_text(encoding="utf-8", errors="replace")
        return PlainTextResponse(text)

    media_type, _ = mimetypes.guess_type(filename)
    return FileResponse(
        path=abs_path,
        filename=filename if disp == "attachment" else None,
        media_type=media_type,
        content_disposition_type=disp,
    )


@router.get("/{name}/content")
async def get_skill_content(name: str) -> dict:
    """读取系统 skill 的 SKILL.md 原始内容（从 NFS 读取）"""
    content = read_skill_content(name)
    if content is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"skill '{name}' 文件不存在")
    return {"name": name, "raw": content}


@router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill(
    name: str,
    user_id: str | None = Query(None, description="用户 ID；不传则删除系统 Skill"),
) -> None:
    """删除 skill（本地 SQLite 元数据 + NFS 文件）。user_id 有值时删用户 skill，否则删系统 skill。"""
    uid = user_id.strip() if user_id else None
    if uid:
        fs_deleted = delete_user_skill_files(uid, name)
    else:
        fs_deleted = delete_skill_files(name)
    db_deleted = await skill_meta_store.delete_skill_meta(name, uid)
    if not fs_deleted and not db_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"skill '{name}' 不存在")
