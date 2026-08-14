"""Workspace 写操作与下载（mkdir / upload / delete / download）。"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from pi_shared.workspace.constants import (
    MAX_UPLOAD_BYTES,
    ROOT_VISIBLE_DIRS,
    SESSION_ZONE_UPLOADS,
    WRITABLE_ROOT,
)
from pi_shared.workspace.errors import WorkspaceError
from pi_shared.workspace.paths import (
    ensure_session_workspace_zones,
    is_session_workspace_root,
    is_session_zone_root,
    require_writable,
    resolve_under_user,
    safe_filename,
    session_workspace_root_rel,
    validate_session_id,
)

logger = logging.getLogger(__name__)


def _unique_dest(dir_abs: Path, safe_name: str) -> Path:
    dest = dir_abs / safe_name
    if not dest.exists():
        return dest
    stem = dest.stem
    suffix = dest.suffix
    index = 1
    while True:
        candidate = dir_abs / f"{stem}_{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def _require_upload_size(data: bytes) -> None:
    if len(data) > MAX_UPLOAD_BYTES:
        raise WorkspaceError(f"文件超过大小限制（{MAX_UPLOAD_BYTES} bytes）", 413)


def mkdir(sandbox_root: str | Path, user_id: str, rel_path: str) -> str:
    abs_path, rel = resolve_under_user(sandbox_root, user_id, rel_path)
    require_writable(rel)
    if abs_path.exists():
        raise WorkspaceError("路径已存在", 409)
    abs_path.mkdir(parents=True, exist_ok=False)
    logger.info("workspace mkdir user=%s path=%s", user_id, rel)
    return rel


def save_upload(
    sandbox_root: str | Path, user_id: str, dir_rel: str, filename: str, data: bytes,
) -> str:
    _require_upload_size(data)
    name = safe_filename(filename)

    dir_abs, dir_norm = resolve_under_user(sandbox_root, user_id, dir_rel)
    require_writable(dir_norm)
    if not dir_abs.exists():
        raise WorkspaceError("目标目录不存在", 404)
    if not dir_abs.is_dir():
        raise WorkspaceError("目标不是目录", 400)

    dest_rel = f"{dir_norm}/{name}" if dir_norm else name
    require_writable(dest_rel)
    dest_abs, _ = resolve_under_user(sandbox_root, user_id, dest_rel)
    if dest_abs.exists():
        raise WorkspaceError("文件已存在", 409)

    dest_abs.write_bytes(data)
    logger.info("workspace upload user=%s path=%s size=%d", user_id, dest_rel, len(data))
    return dest_rel


def delete_entry(sandbox_root: str | Path, user_id: str, rel_path: str) -> None:
    abs_path, rel = resolve_under_user(sandbox_root, user_id, rel_path)
    require_writable(rel)
    if rel == WRITABLE_ROOT:
        raise WorkspaceError("不能删除 files 根目录", 403)
    if is_session_workspace_root(rel):
        raise WorkspaceError("不能删除会话工作区根目录", 403)
    if is_session_zone_root(rel):
        raise WorkspaceError("不能删除会话分区根目录", 403)
    if not abs_path.exists():
        raise WorkspaceError("路径不存在", 404)
    if abs_path.is_dir():
        shutil.rmtree(abs_path)
    else:
        abs_path.unlink()
    logger.info("workspace delete user=%s path=%s", user_id, rel)


def open_download(sandbox_root: str | Path, user_id: str, rel_path: str) -> tuple[Path, str]:
    abs_path, rel = resolve_under_user(sandbox_root, user_id, rel_path)
    if not abs_path.exists():
        raise WorkspaceError("路径不存在", 404)
    if abs_path.is_dir():
        raise WorkspaceError("不能下载目录", 400)
    top = rel.split("/", 1)[0] if rel else ""
    if top not in ROOT_VISIBLE_DIRS:
        raise WorkspaceError("禁止下载该路径", 403)
    return abs_path, abs_path.name


def save_session_workspace_upload(
    sandbox_root: str | Path,
    user_id: str,
    session_id: str,
    filename: str,
    data: bytes,
) -> dict:
    """写入 users/{uid}/sessions/{sid}/workspace/uploads/{filename}。"""
    _require_upload_size(data)
    sid = validate_session_id(session_id)
    name = safe_filename(filename)

    workspace_rel = session_workspace_root_rel(sid)
    workspace_abs, _ = resolve_under_user(sandbox_root, user_id, workspace_rel)
    ensure_session_workspace_zones(workspace_abs)

    uploads_abs = workspace_abs / SESSION_ZONE_UPLOADS
    dest_abs = _unique_dest(uploads_abs, name)
    dest_abs.write_bytes(data)
    relative_path = f"{SESSION_ZONE_UPLOADS}/{dest_abs.name}"
    logger.info(
        "session workspace upload user=%s session=%s file=%s size=%d",
        user_id, sid, relative_path, len(data),
    )
    return {
        "filename": dest_abs.name,
        "relative_path": relative_path,
        "stored_path": str(dest_abs),
        "size": len(data),
    }
